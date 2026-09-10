import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { suggestColumnMapping, tryDirectMapping, type TargetField } from '../../lib/csvMapper'
import { validateCourseRows, validateInstructorRows, type RowIssue } from '../../lib/importValidation'
import toast from 'react-hot-toast'
import Papa from 'papaparse'

type ImportType = 'courses' | 'instructors'

interface CourseRow {
  code: string
  name: string
  description?: string
}

interface InstructorRow {
  full_name: string
  email: string
  department: string
  title: string
  max_hours?: string
}

interface ManageInstructorResponse {
  id?: string
  password?: string
  error?: string
}

interface ImportedCredential {
  full_name: string
  email: string
  password: string
}

const COURSE_FIELDS: TargetField[] = [
  { key: 'code', label: 'Course Code', required: true },
  { key: 'name', label: 'Course Name', required: true },
  { key: 'description', label: 'Description', required: false }
]

const INSTRUCTOR_FIELDS: TargetField[] = [
  { key: 'full_name', label: 'Full Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'department', label: 'Department', required: false },
  { key: 'title', label: 'Title', required: false },
  { key: 'max_hours', label: 'Max Hours / Term', required: false }
]

export default function AdminImport() {
  const { user } = useAuthStore()
  const [importType, setImportType] = useState<ImportType>('courses')
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [importedCredentials, setImportedCredentials] = useState<ImportedCredential[]>([])

  const [columnMapping, setColumnMapping] = useState<Record<string, string | null>>({})
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingNeedsReview, setMappingNeedsReview] = useState(false)
  const [mappingConfirmed, setMappingConfirmed] = useState(false)
  const [rowIssues, setRowIssues] = useState<Map<number, string[]>>(new Map())
  const [validating, setValidating] = useState(false)

  const targetFields = importType === 'courses' ? COURSE_FIELDS : INSTRUCTOR_FIELDS

  const resetFile = () => {
    setRawRows([])
    setRawHeaders([])
    setFileName('')
    setColumnMapping({})
    setMappingNeedsReview(false)
    setMappingConfirmed(false)
    setRowIssues(new Map())
  }

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file')
      return
    }
    resetFile()
    setFileName(file.name)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data
        setRawRows(data)
        const headers = data.length > 0 ? Object.keys(data[0]) : []
        setRawHeaders(headers)

        const direct = tryDirectMapping(headers, targetFields)
        if (direct) {
          setColumnMapping(direct)
          setMappingNeedsReview(false)
          setMappingConfirmed(true)
          return
        }

        setMappingNeedsReview(true)
        setMappingLoading(true)
        try {
          const suggested = await suggestColumnMapping(headers, targetFields)
          setColumnMapping(suggested)
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'Unknown error'
          toast.error(`Could not auto-suggest column mapping: ${detail}. Please map columns manually below.`)
          setColumnMapping(Object.fromEntries(targetFields.map(f => [f.key, null])))
        } finally {
          setMappingLoading(false)
        }
      }
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const mappedRows = useMemo(() => {
    return rawRows.map(row => {
      const out: Record<string, string> = {}
      for (const field of targetFields) {
        const header = columnMapping[field.key]
        out[field.key] = header ? (row[header] || '').trim() : ''
      }
      return out
    })
  }, [rawRows, columnMapping, targetFields])

  useEffect(() => {
    if (!mappingConfirmed || mappedRows.length === 0) {
      setRowIssues(new Map())
      return
    }
    let cancelled = false
    setValidating(true)
    const run = async () => {
      const issues: RowIssue[] = importType === 'courses'
        ? await validateCourseRows(mappedRows as unknown as CourseRow[])
        : await validateInstructorRows(mappedRows as unknown as InstructorRow[])
      if (cancelled) return
      const map = new Map<number, string[]>()
      for (const issue of issues) {
        const list = map.get(issue.rowIndex) || []
        list.push(issue.message)
        map.set(issue.rowIndex, list)
      }
      setRowIssues(map)
      setValidating(false)
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingConfirmed, mappedRows, importType])

  const requiredFieldsMapped = targetFields.filter(f => f.required).every(f => !!columnMapping[f.key])

  const handleImport = async () => {
    const validRows = mappedRows.filter((_, i) => !rowIssues.has(i))
    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }
    setImporting(true)
    setImportedCredentials([])

    let successCount = 0
    let errorCount = 0

    if (importType === 'courses') {
      for (const row of validRows as unknown as CourseRow[]) {
        const { error } = await supabase.from('courses').insert({
          code: row.code.trim(),
          name: row.name.trim(),
          description: row.description?.trim() || null
        })
        if (error) errorCount++
        else successCount++
      }
      await logAction(user!.id, 'imported', 'course', undefined, { count: successCount })
    }

    if (importType === 'instructors') {
      const newCredentials: ImportedCredential[] = []
      for (const row of validRows as unknown as InstructorRow[]) {
        const { data, error } = await supabase.functions.invoke<ManageInstructorResponse>('manage-instructor', {
          body: {
            action: 'create',
            full_name: row.full_name.trim(),
            email: row.email.trim(),
            department: row.department?.trim() || 'Unknown',
            title: row.title?.trim() || 'Instructor',
            max_hours_per_term: parseInt(row.max_hours || '40') || 40
          }
        })
        if (error || data?.error || !data?.password) {
          errorCount++
          continue
        }
        newCredentials.push({ full_name: row.full_name.trim(), email: row.email.trim(), password: data.password })
        successCount++
      }
      setImportedCredentials(newCredentials)
      await logAction(user!.id, 'imported', 'instructor', undefined, { count: successCount })
    }

    setImporting(false)

    if (successCount > 0) toast.success(`${successCount} ${importType} imported successfully!`)
    if (errorCount > 0) toast.error(`${errorCount} rows failed on import — check for duplicates created since validation ran`)
    const skipped = mappedRows.length - validRows.length
    if (skipped > 0) toast(`${skipped} row(s) skipped due to validation issues`, { icon: 'ℹ️' })

    resetFile()
  }

  const tabs: { value: ImportType; label: string }[] = [
    { value: 'courses', label: 'Courses' },
    { value: 'instructors', label: 'Instructors' },
  ]

  const issueCount = rowIssues.size

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Import
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Bulk import courses or instructors from a CSV file — columns don't need to match exactly, AI will suggest a mapping
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {tabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setImportType(tab.value); resetFile() }}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: importType === tab.value ? 'none' : '1px solid rgba(0,0,0,0.07)',
              background: importType === tab.value ? '#534AB7' : 'white',
              color: importType === tab.value ? 'white' : '#6B6B80',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{
        background: '#EEEDFE',
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        border: '1px solid rgba(83,74,183,0.2)'
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#534AB7', marginBottom: 8 }}>
          Expected fields for {importType} (your CSV's column names don't need to match — we'll map them):
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {targetFields.map(f => (
            <span key={f.key} style={{
              background: 'white',
              color: '#534AB7',
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid rgba(83,74,183,0.2)'
            }}>
              {f.label}{!f.required && ' (optional)'}
            </span>
          ))}
        </div>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? '#534AB7' : '#e5e7eb'}`,
          borderRadius: 12,
          padding: 48,
          textAlign: 'center',
          background: dragging ? '#EEEDFE' : 'white',
          marginBottom: 24,
          transition: 'all 0.2s',
          cursor: 'pointer'
        }}
        onClick={() => document.getElementById('csvInput')?.click()}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 8 }}>
          {fileName ? fileName : 'Drop your CSV file here'}
        </div>
        <div style={{ fontSize: 13, color: '#6B6B80' }}>
          {fileName ? `${rawRows.length} rows ready` : 'or click to browse'}
        </div>
        <input
          id="csvInput"
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>

      {mappingNeedsReview && (
        <div style={{
          background: 'white', borderRadius: 12, border: '1.5px solid #534AB7',
          padding: 20, marginBottom: 24
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A2E', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            ✨ Column mapping
          </div>
          <div style={{ fontSize: 13, color: '#6B6B80', marginBottom: 16 }}>
            {mappingLoading
              ? 'AI is matching your CSV columns to the expected fields...'
              : 'Your CSV headers didn\'t match exactly — review the AI\'s suggested mapping below before importing.'}
          </div>
          {!mappingLoading && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {targetFields.map(field => (
                  <div key={field.key}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                      {field.label}{field.required && ' *'}
                    </label>
                    <select
                      value={columnMapping[field.key] || ''}
                      onChange={e => setColumnMapping(prev => ({ ...prev, [field.key]: e.target.value || null }))}
                      style={{
                        width: '100%', padding: '9px 12px', borderRadius: 8,
                        border: `1.5px solid ${field.required && !columnMapping[field.key] ? '#A32D2D' : '#e5e7eb'}`,
                        fontSize: 13, fontFamily: 'DM Sans, sans-serif', color: '#1A1A2E', background: 'white'
                      }}
                    >
                      <option value="">— none —</option>
                      {rawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setMappingConfirmed(true)}
                disabled={!requiredFieldsMapped}
                style={{
                  padding: '9px 20px',
                  background: requiredFieldsMapped ? '#534AB7' : '#a09ad4',
                  color: 'white', border: 'none', borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: requiredFieldsMapped ? 'pointer' : 'not-allowed',
                  fontFamily: 'DM Sans, sans-serif'
                }}
              >
                Apply Mapping & Continue
              </button>
            </>
          )}
        </div>
      )}

      {mappingConfirmed && mappedRows.length > 0 && (
        <div style={{
          background: 'white',
          borderRadius: 12,
          border: '1px solid rgba(0,0,0,0.07)',
          overflow: 'hidden',
          marginBottom: 24
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E' }}>
              Preview — {mappedRows.length} rows
            </h2>
            {validating && <span style={{ fontSize: 12, color: '#6B6B80' }}>Checking for issues...</span>}
            {!validating && issueCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#A32D2D' }}>
                {issueCount} row{issueCount > 1 ? 's' : ''} will be skipped
              </span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                  {targetFields.map(f => (
                    <th key={f.key} style={{
                      padding: '10px 16px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#6B6B80',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {f.label}
                    </th>
                  ))}
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Issues
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 8).map((row, i) => {
                  const issues = rowIssues.get(i)
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', background: issues ? '#FCEBEB' : 'white' }}>
                      {targetFields.map(f => (
                        <td key={f.key} style={{ padding: '10px 16px', fontSize: 13, color: '#1A1A2E' }}>
                          {row[f.key] || '—'}
                        </td>
                      ))}
                      <td style={{ padding: '10px 16px', fontSize: 12, color: '#A32D2D' }}>
                        {issues ? issues.join('; ') : ''}
                      </td>
                    </tr>
                  )
                })}
                {mappedRows.length > 8 && (
                  <tr>
                    <td colSpan={targetFields.length + 1} style={{
                      padding: '10px 16px',
                      fontSize: 13,
                      color: '#6B6B80',
                      textAlign: 'center'
                    }}>
                      ... and {mappedRows.length - 8} more rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mappingConfirmed && mappedRows.length > 0 && (
        <button
          onClick={handleImport}
          disabled={importing || validating || mappedRows.length - issueCount === 0}
          style={{
            padding: '11px 32px',
            background: (importing || validating || mappedRows.length - issueCount === 0) ? '#a09ad4' : '#534AB7',
            color: 'white',
            border: 'none',
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: (importing || validating || mappedRows.length - issueCount === 0) ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {importing ? 'Importing...' : `Import ${mappedRows.length - issueCount} ${importType}`}
        </button>
      )}

      {importedCredentials.length > 0 && (
        <div style={{
          background: '#FAEEDA', borderRadius: 12, padding: 20,
          marginTop: 24, border: '1px solid rgba(133,79,11,0.25)'
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#854F0B', marginBottom: 4 }}>
            Save these temporary passwords now — they won't be shown again
          </div>
          <div style={{ fontSize: 13, color: '#854F0B', marginBottom: 16 }}>
            Each imported instructor got a unique temporary password. Share these with them directly; there's no email delivery yet, so this is the only place they appear.
          </div>
          <div style={{ background: 'white', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                  {['Name', 'Email', 'Temporary Password'].map(h => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: 'left', fontSize: 12,
                      fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px'
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importedCredentials.map(cred => (
                  <tr key={cred.email} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: '#1A1A2E' }}>{cred.full_name}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: '#1A1A2E' }}>{cred.email}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: '#1A1A2E', fontFamily: 'monospace' }}>{cred.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
