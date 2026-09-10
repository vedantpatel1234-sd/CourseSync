import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import { formatDayTime } from '../../lib/schedule'
import { checkAssignmentConflicts } from '../../lib/conflicts'
import toast from 'react-hot-toast'

interface Section {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course: { code: string; name: string }
  term: { name: string }
}

interface Instructor {
  id: string
  full_name: string
  hoursAssigned: number
  maxHours: number
}

interface AssignmentRow {
  instructor_id: string
  hours_assigned: number
  section_id: string
  section: {
    id: string
    section_number: string
    hours_required: number
    day_of_week: string | null
    time_slot: string | null
    course: { code: string }
  }
}

interface AvailabilityRow {
  instructor_id: string
  day: string
  time_slot: string
}

interface Suggestion {
  section: Section
  instructor: Instructor
  score: number
  qualificationMatch: boolean
  preferenceRank: number | null
  hoursOk: boolean
  accepted: boolean
}

export default function AdminMatching() {
  const { user } = useAuthStore()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [excludedCount, setExcludedCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  const runMatching = async () => {
    setLoading(true)
    setHasRun(false)
    setSuggestions([])
    setExcludedCount(0)

    const { data: sections } = await supabase
      .from('sections')
      .select('*, course:courses(code, name), term:terms(name)')
      .eq('status', 'unassigned')

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*, instructor_profiles(*)')
      .eq('role', 'instructor')

    const { data: assignments } = await supabase
      .from('assignments')
      .select('instructor_id, hours_assigned, section_id, section:sections!assignments_section_id_fkey(id, section_number, hours_required, day_of_week, time_slot, course:courses(code))')
      .is('draft_id', null)
      .neq('status', 'rejected')

    const { data: availability } = await supabase
      .from('instructor_availability')
      .select('instructor_id, day, time_slot')

    const { data: qualifications } = await supabase
      .from('qualifications')
      .select('*')
      .eq('verified', true)

    const { data: preferences } = await supabase
      .from('preferences')
      .select('*')
      .order('rank')

    if (!sections || !profiles) {
      toast.error('Could not load data')
      setLoading(false)
      return
    }

    if (sections.length === 0) {
      toast('All sections are already assigned!', { icon: 'ℹ️' })
      setLoading(false)
      setHasRun(true)
      return
    }

    const assignmentRows = (assignments || []) as unknown as AssignmentRow[]
    const availabilityRows = (availability || []) as AvailabilityRow[]

    const instructors: Instructor[] = profiles.map(p => ({
      id: p.id,
      full_name: p.full_name,
      hoursAssigned: assignmentRows
        .filter(a => a.instructor_id === p.id)
        .reduce((sum, a) => sum + a.hours_assigned, 0),
      maxHours: p.instructor_profiles?.max_hours_per_term || 40
    }))

    const results: Suggestion[] = []
    const usedInstructors = new Set<string>()
    let excluded = 0

    for (const section of sections as Section[]) {
      let bestSuggestion: Suggestion | null = null
      let bestScore = -1

      for (const instructor of instructors) {
        if (usedInstructors.has(instructor.id)) continue

        // Conflict-check first: an instructor who is double-booked, unavailable, or
        // over hours for this section is excluded outright rather than merely scored
        // low — so the matching engine never suggests an assignment that would fail.
        const conflicts = checkAssignmentConflicts({
          instructorName: instructor.full_name,
          targetSection: section,
          existingAssignments: assignmentRows.filter(a => a.instructor_id === instructor.id),
          unavailableSlots: availabilityRows.filter(a => a.instructor_id === instructor.id),
          hoursAlreadyAssigned: instructor.hoursAssigned,
          maxHoursPerTerm: instructor.maxHours
        })

        if (conflicts.length > 0) {
          excluded++
          continue
        }

        const remaining = instructor.maxHours - instructor.hoursAssigned
        const hoursOk = remaining >= section.hours_required

        const hasQual = qualifications?.some(
          q => q.instructor_id === instructor.id
        ) || false

        const pref = preferences?.find(
          p => p.instructor_id === instructor.id && p.section_id === section.id
        )
        const preferenceRank = pref?.rank || null

        let score = 0
        if (hoursOk) score += 40
        if (hasQual) score += 30
        if (preferenceRank === 1) score += 30
        else if (preferenceRank === 2) score += 20
        else if (preferenceRank === 3) score += 10
        else if (preferenceRank !== null) score += 5

        if (score > bestScore) {
          bestScore = score
          bestSuggestion = {
            section: section as Section,
            instructor,
            score,
            qualificationMatch: hasQual,
            preferenceRank,
            hoursOk,
            accepted: false
          }
        }
      }

      if (bestSuggestion) {
        results.push(bestSuggestion)
        usedInstructors.add(bestSuggestion.instructor.id)
      }
    }

    setSuggestions(results)
    setExcludedCount(excluded)
    setLoading(false)
    setHasRun(true)

    if (results.length === 0) {
      toast('No instructors available for remaining sections', { icon: 'ℹ️' })
    } else {
      toast.success(`Found ${results.length} suggestions!`)
    }
  }

  const toggleAccept = (index: number) => {
    setSuggestions(prev => prev.map((s, i) => i === index ? { ...s, accepted: !s.accepted } : s))
  }

  const acceptAll = () => {
    setSuggestions(prev => prev.map(s => ({ ...s, accepted: s.hoursOk })))
  }

  const publishAccepted = async () => {
    const accepted = suggestions.filter(s => s.accepted)
    if (accepted.length === 0) {
      toast.error('No suggestions accepted')
      return
    }
    setPublishing(true)

    let successCount = 0
    for (const suggestion of accepted) {
      const { error } = await supabase.from('assignments').insert({
        instructor_id: suggestion.instructor.id,
        section_id: suggestion.section.id,
        hours_assigned: suggestion.section.hours_required,
        assigned_by: user?.id,
        status: 'active'
      })
      if (error) {
        toast.error(`Failed: ${suggestion.section.course.code} — ${error.message}`)
      } else {
        successCount++
        await notifyInstructor(
          suggestion.instructor.id,
          'notify_assigned',
          `You were assigned to ${suggestion.section.course.code} Section ${suggestion.section.section_number} (${formatDayTime(suggestion.section.day_of_week, suggestion.section.time_slot)}).`
        )
      }
    }

    await logAction(user!.id, 'matching_published', 'assignment', undefined, {
      count: successCount
    })

    toast.success(`${successCount} assignments published!`)
    setPublishing(false)
    setSuggestions([])
    setHasRun(false)
  }

  const getScoreColor = (score: number) => {
    if (score >= 70) return { color: '#0F6E56', bg: '#EAF3DE' }
    if (score >= 40) return { color: '#854F0B', bg: '#FAEEDA' }
    return { color: '#A32D2D', bg: '#FCEBEB' }
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Matching Engine
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Automatically match instructors to unassigned sections
      </p>

      {/* Weights info */}
      <div style={{
        background: '#EEEDFE', borderRadius: 12, padding: 20,
        marginBottom: 24, border: '1px solid rgba(83,74,183,0.2)'
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 12 }}>
          Scoring Weights
        </h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Hours available', weight: '40pts' },
            { label: 'Qualified for course', weight: '30pts' },
            { label: 'Preference rank #1', weight: '30pts' },
            { label: 'Preference rank #2', weight: '20pts' },
            { label: 'Preference rank #3', weight: '10pts' },
          ].map(w => (
            <div key={w.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#534AB7', color: 'white',
                padding: '2px 8px', borderRadius: 20,
                fontSize: 11, fontWeight: 700
              }}>
                {w.weight}
              </span>
              <span style={{ fontSize: 13, color: '#534AB7' }}>{w.label}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#534AB7', marginTop: 12, opacity: 0.8 }}>
          Instructors who are double-booked, marked unavailable, or over their max hours for a
          section are excluded from suggestions entirely — they are never scored or proposed.
        </div>
      </div>

      {/* Run button */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={runMatching}
          disabled={loading}
          style={{
            padding: '11px 28px',
            background: loading ? '#a09ad4' : '#534AB7',
            color: 'white', border: 'none', borderRadius: 9,
            fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {loading ? 'Running...' : '⚡ Run Matching'}
        </button>

        {hasRun && suggestions.length > 0 && (
          <>
            <button
              onClick={acceptAll}
              style={{
                padding: '11px 28px',
                background: 'white', color: '#534AB7',
                border: '1.5px solid #534AB7', borderRadius: 9,
                fontSize: 14, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
              }}
            >
              Accept All
            </button>
            <button
              onClick={publishAccepted}
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
              {publishing ? 'Publishing...' : 'Publish Accepted'}
            </button>
          </>
        )}
      </div>

      {hasRun && excludedCount > 0 && (
        <div style={{
          background: '#FAEEDA', border: '1px solid rgba(133,79,11,0.25)',
          borderRadius: 9, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: '#854F0B'
        }}>
Skipped {excludedCount} instructor match{excludedCount > 1 ? 'es' : ''} due to scheduling conflicts,
          unavailability, or exceeding max hours.
        </div>
      )}

      {/* Suggestions table */}
      {hasRun && (
        <div style={{
          background: 'white', borderRadius: 12,
          border: '1px solid rgba(0,0,0,0.07)', overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                {['Section', 'Day / Time', 'Instructor', 'Score', 'Hours OK', 'Preference', 'Accept'].map(h => (
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
              {suggestions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                    All sections are assigned! 🎉
                  </td>
                </tr>
              ) : suggestions.map((s, index) => {
                const scoreColor = getScoreColor(s.score)
                return (
                  <tr key={index} style={{
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    background: s.accepted ? '#f0fdf4' : 'white'
                  }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                        {s.section.course.code}
                      </span>
                      <span style={{ fontSize: 13, color: '#6B6B80', marginLeft: 8 }}>
                        §{s.section.section_number}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80' }}>
                      {formatDayTime(s.section.day_of_week, s.section.time_slot)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E', fontWeight: 500 }}>
                      {s.instructor.full_name}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        background: scoreColor.bg, color: scoreColor.color,
                        padding: '3px 10px', borderRadius: 20,
                        fontSize: 12, fontWeight: 700
                      }}>
                        {s.score}pts
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600,
                        color: s.hoursOk ? '#0F6E56' : '#A32D2D'
                      }}>
                        {s.hoursOk ? '✓ Yes' : '✗ No'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80' }}>
                      {s.preferenceRank ? `Rank #${s.preferenceRank}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => toggleAccept(index)}
                        style={{
                          padding: '6px 14px',
                          background: s.accepted ? '#EAF3DE' : '#f3f4f6',
                          color: s.accepted ? '#0F6E56' : '#6B6B80',
                          border: 'none', borderRadius: 7,
                          fontSize: 13, fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        {s.accepted ? '✓ Accepted' : 'Accept'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
