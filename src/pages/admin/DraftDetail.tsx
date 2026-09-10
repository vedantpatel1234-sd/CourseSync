import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import { formatDayTime } from '../../lib/schedule'
import { checkAssignmentConflicts } from '../../lib/conflicts'
import toast from 'react-hot-toast'

interface DraftInfo {
  id: string
  name: string
  status: 'sandbox' | 'published'
  is_ai_generated: boolean
  term_id: string
  published_at: string | null
  term: { name: string }
}

interface Section {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course: { code: string; name: string }
}

interface Instructor {
  id: string
  full_name: string
  email: string
  hoursAssigned: number
  maxHours: number
  instructor_profiles: { max_hours_per_term: number } | null
}

interface AssignmentRow {
  id: string
  hours_assigned: number
  instructor_id: string
  section_id: string
  ai_rationale: string | null
  instructor: { id: string; full_name: string; email: string }
  section: {
    id: string
    section_number: string
    status: string
    hours_required: number
    day_of_week: string | null
    time_slot: string | null
    course: { code: string; name: string }
    term: { name: string }
  }
}

interface AvailabilityRow {
  instructor_id: string
  day: string
  time_slot: string
}

interface PublishConflict {
  section: AssignmentRow['section']
  draftAssignment: AssignmentRow
  liveAssignment: AssignmentRow
}

export default function AdminDraftDetail() {
  const { draftId } = useParams<{ draftId: string }>()
  const { user } = useAuthStore()

  const [draft, setDraft] = useState<DraftInfo | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [liveAssignments, setLiveAssignments] = useState<AssignmentRow[]>([])
  const [draftAssignments, setDraftAssignments] = useState<AssignmentRow[]>([])
  const [availability, setAvailability] = useState<AvailabilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [selectedSection, setSelectedSection] = useState('')
  const [selectedInstructor, setSelectedInstructor] = useState('')
  const [assigning, setAssigning] = useState(false)

  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishConflicts, setPublishConflicts] = useState<PublishConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, 'keep_live' | 'use_draft'>>({})
  const [publishing, setPublishing] = useState(false)

  const fetchAll = async () => {
    if (!draftId) return
    setLoading(true)

    const { data: draftData } = await supabase
      .from('drafts')
      .select('id, name, status, is_ai_generated, term_id, published_at, term:terms(name)')
      .eq('id', draftId)
      .single()

    if (!draftData) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setDraft(draftData as unknown as DraftInfo)

    const { data: sectionsData } = await supabase
      .from('sections')
      .select('*, course:courses(code, name)')
      .eq('term_id', draftData.term_id)
      .order('created_at')

    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*, instructor_profiles(*)')
      .eq('role', 'instructor')
      .order('full_name')

    const assignmentSelect = `
      id,
      hours_assigned,
      instructor_id,
      section_id,
      ai_rationale,
      instructor:profiles!assignments_instructor_id_fkey(id, full_name, email),
      section:sections!assignments_section_id_fkey(id, section_number, status, hours_required, day_of_week, time_slot, course:courses(code, name), term:terms(name))
    `

    const { data: liveData } = await supabase
      .from('assignments')
      .select(assignmentSelect)
      .is('draft_id', null)
      .neq('status', 'rejected')

    const { data: draftAssignmentsData } = await supabase
      .from('assignments')
      .select(assignmentSelect)
      .eq('draft_id', draftId)

    const { data: availabilityData } = await supabase
      .from('instructor_availability')
      .select('instructor_id, day, time_slot')

    const liveRows = (liveData || []) as unknown as AssignmentRow[]
    const draftRows = (draftAssignmentsData || []) as unknown as AssignmentRow[]
    const allRows = [...liveRows, ...draftRows]

    if (sectionsData) setSections(sectionsData as Section[])

    if (profilesData) {
      const withHours = profilesData.map(p => ({
        ...p,
        hoursAssigned: allRows
          .filter(a => a.instructor_id === p.id)
          .reduce((sum, a) => sum + a.hours_assigned, 0),
        maxHours: p.instructor_profiles?.max_hours_per_term || 40
      }))
      setInstructors(withHours as Instructor[])
    }

    setLiveAssignments(liveRows)
    setDraftAssignments(draftRows)
    if (availabilityData) setAvailability(availabilityData as AvailabilityRow[])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [draftId])

  const selectedSectionObj = useMemo(
    () => sections.find(s => s.id === selectedSection) || null,
    [sections, selectedSection]
  )

  const selectedSectionLiveAssignment = useMemo(
    () => selectedSection ? liveAssignments.find(a => a.section_id === selectedSection) || null : null,
    [selectedSection, liveAssignments]
  )

  const allAssignmentsForConflicts = useMemo(
    () => [...liveAssignments, ...draftAssignments],
    [liveAssignments, draftAssignments]
  )

  const instructorConflicts = useMemo(() => {
    const map: Record<string, string[]> = {}
    if (!selectedSectionObj) return map
    for (const instructor of instructors) {
      map[instructor.id] = checkAssignmentConflicts({
        instructorName: instructor.full_name,
        targetSection: selectedSectionObj,
        existingAssignments: allAssignmentsForConflicts.filter(a => a.instructor_id === instructor.id),
        unavailableSlots: availability.filter(a => a.instructor_id === instructor.id),
        hoursAlreadyAssigned: instructor.hoursAssigned,
        maxHoursPerTerm: instructor.maxHours
      })
    }
    return map
  }, [selectedSectionObj, instructors, allAssignmentsForConflicts, availability])

  const activeConflicts = selectedInstructor ? (instructorConflicts[selectedInstructor] || []) : []

  const handleAddDraftAssignment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || !draftId) return
    if (!selectedSection || !selectedInstructor) {
      toast.error('Please select both a section and an instructor')
      return
    }

    const alreadyInDraft = draftAssignments.find(a => a.section_id === selectedSection)
    if (alreadyInDraft) {
      toast.error('This section already has a draft assignment. Remove it first to reassign.')
      return
    }

    const section = sections.find(s => s.id === selectedSection)
    const instructor = instructors.find(i => i.id === selectedInstructor)
    if (!section || !instructor) return

    const conflicts = checkAssignmentConflicts({
      instructorName: instructor.full_name,
      targetSection: section,
      existingAssignments: allAssignmentsForConflicts.filter(a => a.instructor_id === instructor.id),
      unavailableSlots: availability.filter(a => a.instructor_id === instructor.id),
      hoursAlreadyAssigned: instructor.hoursAssigned,
      maxHoursPerTerm: instructor.maxHours
    })

    if (conflicts.length > 0) {
      conflicts.forEach(reason => toast.error(reason))
      return
    }

    setAssigning(true)
    const { error } = await supabase.from('assignments').insert({
      instructor_id: selectedInstructor,
      section_id: selectedSection,
      hours_assigned: section.hours_required,
      assigned_by: user?.id,
      status: 'active',
      draft_id: draftId
    })

    if (error) {
      toast.error(error.message)
      setAssigning(false)
      return
    }

    await logAction(user!.id, 'draft_assigned', 'assignment', undefined, {
      draft: draft.name,
      instructor: instructor.full_name,
      section: `${section.course.code} ${section.section_number}`
    })

    toast.success('Added to draft!')
    setSelectedSection('')
    setSelectedInstructor('')
    setAssigning(false)
    fetchAll()
  }

  const handleRemoveDraftAssignment = async (assignment: AssignmentRow) => {
    if (!draft) return
    const { error } = await supabase.from('assignments').delete().eq('id', assignment.id)
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'draft_unassigned', 'assignment', assignment.id, {
      draft: draft.name,
      instructor: assignment.instructor.full_name,
      section: `${assignment.section.course.code} ${assignment.section.section_number}`
    })
    toast.success('Removed from draft!')
    fetchAll()
  }

  const handlePublishClick = () => {
    if (draftAssignments.length === 0) {
      toast.error('This draft has no assignments to publish')
      return
    }

    const conflicts: PublishConflict[] = []
    for (const da of draftAssignments) {
      const live = liveAssignments.find(la => la.section_id === da.section_id)
      if (live) conflicts.push({ section: da.section, draftAssignment: da, liveAssignment: live })
    }

    if (conflicts.length === 0) {
      doPublish([], {})
      return
    }

    setPublishConflicts(conflicts)
    setResolutions({})
    setShowPublishModal(true)
  }

  const doPublish = async (
    conflicts: PublishConflict[],
    conflictResolutions: Record<string, 'keep_live' | 'use_draft'>
  ) => {
    if (!draft || !draftId) return
    setPublishing(true)

    const conflictSectionIds = new Set(conflicts.map(c => c.section.id))
    const autoAssignments = draftAssignments.filter(da => !conflictSectionIds.has(da.section_id))

    let autoCount = 0
    let usedDraftCount = 0
    let keptLiveCount = 0
    let errorCount = 0

    for (const da of autoAssignments) {
      const { error } = await supabase.from('assignments').update({ draft_id: null }).eq('id', da.id)
      if (error) { errorCount++; continue }
      autoCount++
      await logAction(user!.id, 'published', 'assignment', da.id, {
        draft: draft.name,
        instructor: da.instructor.full_name,
        section: `${da.section.course.code} ${da.section.section_number}`,
        resolution: 'auto'
      })
      await notifyInstructor(
        da.instructor_id,
        'notify_assigned',
        `You were assigned to ${da.section.course.code} Section ${da.section.section_number} (${formatDayTime(da.section.day_of_week, da.section.time_slot)}).`
      )
    }

    for (const conflict of conflicts) {
      const resolution = conflictResolutions[conflict.section.id]
      if (resolution === 'use_draft') {
        const { error: delError } = await supabase.from('assignments').delete().eq('id', conflict.liveAssignment.id)
        if (delError) { errorCount++; continue }
        const { error: updError } = await supabase.from('assignments').update({ draft_id: null }).eq('id', conflict.draftAssignment.id)
        if (updError) { errorCount++; continue }
        usedDraftCount++
        await logAction(user!.id, 'published', 'assignment', conflict.draftAssignment.id, {
          draft: draft.name,
          instructor: conflict.draftAssignment.instructor.full_name,
          section: `${conflict.section.course.code} ${conflict.section.section_number}`,
          resolution: 'used_draft_override',
          replaced: conflict.liveAssignment.instructor.full_name
        })
        await notifyInstructor(
          conflict.liveAssignment.instructor_id,
          'notify_unassigned',
          `You were removed from ${conflict.section.course.code} Section ${conflict.section.section_number}.`
        )
        await notifyInstructor(
          conflict.draftAssignment.instructor_id,
          'notify_assigned',
          `You were assigned to ${conflict.section.course.code} Section ${conflict.section.section_number} (${formatDayTime(conflict.section.day_of_week, conflict.section.time_slot)}).`
        )
      } else {
        const { error } = await supabase.from('assignments').delete().eq('id', conflict.draftAssignment.id)
        if (error) { errorCount++; continue }
        keptLiveCount++
        await logAction(user!.id, 'draft_discarded', 'assignment', conflict.draftAssignment.id, {
          draft: draft.name,
          instructor: conflict.draftAssignment.instructor.full_name,
          section: `${conflict.section.course.code} ${conflict.section.section_number}`,
          resolution: 'kept_live',
          keptInstructor: conflict.liveAssignment.instructor.full_name
        })
      }
    }

    await supabase
      .from('drafts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', draftId)

    await logAction(user!.id, 'published', 'draft', draftId, {
      name: draft.name,
      autoConverted: autoCount,
      usedDraftOverride: usedDraftCount,
      keptLive: keptLiveCount
    })

    setPublishing(false)
    setShowPublishModal(false)

    if (errorCount > 0) {
      toast.error(`Draft published with ${errorCount} error(s) — check Assignments and Audit Log`)
    } else {
      toast.success(`Draft published! ${autoCount + usedDraftCount} assignment(s) are now live.`)
    }
    fetchAll()
  }

  const allConflictsResolved = publishConflicts.length > 0 &&
    publishConflicts.every(c => resolutions[c.section.id])

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 9,
    border: '1.5px solid #e5e7eb',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    color: '#1A1A2E',
    background: 'white'
  }

  const draftAssignedSectionIds = draftAssignments.map(a => a.section_id)

  if (notFound) {
    return (
      <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
        <p style={{ color: '#6B6B80', marginBottom: 16 }}>Draft not found.</p>
        <Link to="/admin/drafts" style={{ color: '#534AB7', fontWeight: 600 }}>← Back to Drafts</Link>
      </div>
    )
  }

  if (loading || !draft) {
    return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <Link to="/admin/drafts" style={{ color: '#534AB7', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        ← Back to Drafts
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E' }}>{draft.name}</h1>
        <span style={{
          padding: '4px 12px', borderRadius: 20,
          fontSize: 12, fontWeight: 600,
          background: draft.status === 'published' ? '#EAF3DE' : '#FAEEDA',
          color: draft.status === 'published' ? '#0F6E56' : '#854F0B',
          textTransform: 'capitalize'
        }}>
          {draft.status}
        </span>
      </div>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        {draft.term.name} sandbox — assignments here are only visible to admins until published
      </p>

      {draft.status === 'published' ? (
        <div style={{
          background: '#EAF3DE', border: '1px solid rgba(15,110,86,0.25)',
          borderRadius: 12, padding: 20, color: '#0F6E56'
        }}>
          This draft was published. Its assignments are now live —{' '}
          <Link to="/admin/assignments" style={{ color: '#0F6E56', fontWeight: 600 }}>view them on the Assignments page</Link>.
        </div>
      ) : (
        <>
          {/* Info banner */}
          <div style={{
            background: '#EEEDFE', borderRadius: 12, padding: 16,
            marginBottom: 24, border: '1px solid rgba(83,74,183,0.2)',
            display: 'flex', alignItems: 'flex-start', gap: 12
          }}>
            <span style={{ fontSize: 20 }}>{draft.is_ai_generated ? '✨' : '🧪'}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 4 }}>
                {draft.is_ai_generated ? 'AI-Generated Sandbox' : 'Sandbox Mode'}
              </div>
              <div style={{ fontSize: 13, color: '#534AB7' }}>
                {draft.is_ai_generated
                  ? 'Claude proposed these assignments — review the rationale under each one before publishing. Instructors and coordinators cannot see them, and they have no effect on live scheduling until you publish.'
                  : 'Assignments you make here only exist inside this draft. Instructors and coordinators cannot see them, and they have no effect on live scheduling until you publish.'}
              </div>
            </div>
          </div>

          {/* Add draft assignment form */}
          <div style={{
            background: 'white', borderRadius: 12, padding: 24,
            border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
              Add Draft Assignment
            </h2>
            <form onSubmit={handleAddDraftAssignment}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                    Section
                  </label>
                  <select
                    value={selectedSection}
                    onChange={e => { setSelectedSection(e.target.value); setSelectedInstructor('') }}
                    style={inputStyle}
                  >
                    <option value="">Select section...</option>
                    {sections.map(s => {
                      const inDraft = draftAssignedSectionIds.includes(s.id)
                      const live = liveAssignments.find(a => a.section_id === s.id)
                      const marker = inDraft ? '✓ In Draft' : live ? `🔴 Live: ${live.instructor.full_name}` : ''
                      return (
                        <option key={s.id} value={s.id}>
                          {s.course.code} — Section {s.section_number} ({s.hours_required}h, {formatDayTime(s.day_of_week, s.time_slot)}) {marker}
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                    Instructor
                  </label>
                  <select value={selectedInstructor} onChange={e => setSelectedInstructor(e.target.value)} style={inputStyle}>
                    <option value="">Select instructor...</option>
                    {instructors.map(i => {
                      const hasConflict = selectedSectionObj ? (instructorConflicts[i.id]?.length ?? 0) > 0 : false
                      return (
                        <option key={i.id} value={i.id}>
                          {i.full_name} ({i.hoursAssigned}/{i.maxHours}h used) {hasConflict ? '⚠ Conflict' : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              </div>

              {selectedSectionLiveAssignment && (
                <div style={{
                  background: '#FAEEDA', border: '1px solid rgba(133,79,11,0.25)',
                  borderRadius: 9, padding: '10px 16px', marginBottom: 16,
                  fontSize: 13, color: '#854F0B'
                }}>
                  This section is already live-assigned to {selectedSectionLiveAssignment.instructor.full_name}.
                  Adding a draft assignment here lets you choose which one wins when you publish.
                </div>
              )}

              {activeConflicts.length > 0 && (
                <div style={{
                  background: '#FCEBEB', border: '1px solid rgba(163,45,45,0.25)',
                  borderRadius: 9, padding: '12px 16px', marginBottom: 16
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D', marginBottom: 6 }}>
                    Cannot assign — {activeConflicts.length} conflict{activeConflicts.length > 1 ? 's' : ''} found
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {activeConflicts.map((reason, idx) => (
                      <li key={idx} style={{ fontSize: 13, color: '#A32D2D', marginBottom: 2 }}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="submit"
                disabled={assigning || activeConflicts.length > 0}
                style={{
                  padding: '10px 24px',
                  background: (assigning || activeConflicts.length > 0) ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                  color: 'white', border: 'none', borderRadius: 9,
                  fontSize: 14, fontWeight: 600,
                  cursor: (assigning || activeConflicts.length > 0) ? 'not-allowed' : 'pointer',
                  fontFamily: 'DM Sans, sans-serif'
                }}
              >
                {assigning ? 'Adding...' : 'Add to Draft'}
              </button>
            </form>
          </div>

          {/* Publish button */}
          <div style={{ marginBottom: 24 }}>
            <button
              onClick={handlePublishClick}
              disabled={publishing}
              style={{
                padding: '11px 28px',
                background: publishing ? '#a09ad4' : '#0F6E56',
                color: 'white', border: 'none', borderRadius: 9,
                fontSize: 14, fontWeight: 600,
                cursor: publishing ? 'not-allowed' : 'pointer',
                fontFamily: 'DM Sans, sans-serif'
              }}
            >
              {publishing ? 'Publishing...' : '🚀 Publish Draft'}
            </button>
          </div>

          {/* Draft assignments table */}
          <div style={{
            background: 'white', borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E' }}>
                Draft Assignments ({draftAssignments.length})
              </h2>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                  {['Course', 'Section', 'Day / Time', 'Instructor', 'Hours', ''].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left',
                      fontSize: 12, fontWeight: 600, color: '#6B6B80',
                      textTransform: 'uppercase', letterSpacing: '0.5px'
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                      No draft assignments yet. Use the form above.
                    </td>
                  </tr>
                ) : draftAssignments.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                        {a.section.course.code}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                      Section {a.section.section_number}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#1A1A2E' }}>
                      {formatDayTime(a.section.day_of_week, a.section.time_slot)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                      {a.instructor.full_name}
                      {a.ai_rationale && (
                        <div style={{ fontSize: 12, color: '#6B6B80', fontStyle: 'italic', marginTop: 2 }}>
                          ✨ {a.ai_rationale}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                      {a.hours_assigned}h
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => handleRemoveDraftAssignment(a)}
                        style={{
                          padding: '6px 14px', background: '#FCEBEB', color: '#A32D2D',
                          border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Publish conflict review modal */}
      {showPublishModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            background: 'white', borderRadius: 14, padding: 28,
            width: 640, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
            fontFamily: 'DM Sans, sans-serif'
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>
              Resolve Publish Conflicts
            </h2>
            <p style={{ fontSize: 13, color: '#6B6B80', marginBottom: 20 }}>
              {draftAssignments.length - publishConflicts.length} assignment(s) will publish automatically.
              {' '}{publishConflicts.length} section{publishConflicts.length > 1 ? 's' : ''} already {publishConflicts.length > 1 ? 'have' : 'has'} a live
              assignment — pick which one wins for each.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {publishConflicts.map(conflict => {
                const chosen = resolutions[conflict.section.id]
                return (
                  <div key={conflict.section.id} style={{
                    border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: 16
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                      {conflict.section.course.code} — Section {conflict.section.section_number}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B6B80', marginBottom: 12 }}>
                      {formatDayTime(conflict.section.day_of_week, conflict.section.time_slot)}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => setResolutions(prev => ({ ...prev, [conflict.section.id]: 'keep_live' }))}
                        style={{
                          flex: 1, textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                          border: chosen === 'keep_live' ? '2px solid #0F6E56' : '1.5px solid #e5e7eb',
                          background: chosen === 'keep_live' ? '#EAF3DE' : 'white',
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', marginBottom: 2 }}>
                          Keep Live
                        </div>
                        <div style={{ fontSize: 13, color: '#1A1A2E' }}>{conflict.liveAssignment.instructor.full_name}</div>
                      </button>
                      <button
                        onClick={() => setResolutions(prev => ({ ...prev, [conflict.section.id]: 'use_draft' }))}
                        style={{
                          flex: 1, textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                          border: chosen === 'use_draft' ? '2px solid #534AB7' : '1.5px solid #e5e7eb',
                          background: chosen === 'use_draft' ? '#EEEDFE' : 'white',
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#534AB7', textTransform: 'uppercase', marginBottom: 2 }}>
                          Use Draft
                        </div>
                        <div style={{ fontSize: 13, color: '#1A1A2E' }}>{conflict.draftAssignment.instructor.full_name}</div>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setShowPublishModal(false)}
                disabled={publishing}
                style={{
                  padding: '10px 20px', background: '#f3f4f6', color: '#6B6B80',
                  border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600,
                  cursor: publishing ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => doPublish(publishConflicts, resolutions)}
                disabled={!allConflictsResolved || publishing}
                style={{
                  padding: '10px 20px',
                  background: (!allConflictsResolved || publishing) ? '#a09ad4' : '#0F6E56',
                  color: 'white', border: 'none', borderRadius: 9,
                  fontSize: 14, fontWeight: 600,
                  cursor: (!allConflictsResolved || publishing) ? 'not-allowed' : 'pointer',
                  fontFamily: 'DM Sans, sans-serif'
                }}
              >
                {publishing ? 'Publishing...' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
