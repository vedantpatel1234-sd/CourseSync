import { useEffect, useMemo, useState } from 'react'
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
  email: string
  hoursAssigned: number
  maxHours: number
  instructor_profiles: { max_hours_per_term: number } | null
}

interface Assignment {
  id: string
  hours_assigned: number
  instructor_id: string
  section_id: string
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

export default function AdminAssignments() {
  const { user } = useAuthStore()
  const [sections, setSections] = useState<Section[]>([])
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [availability, setAvailability] = useState<AvailabilityRow[]>([])
  const [selectedSection, setSelectedSection] = useState('')
  const [selectedInstructor, setSelectedInstructor] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)

  const fetchAll = async () => {
    setLoading(true)

    const { data: sectionsData } = await supabase
      .from('sections')
      .select('*, course:courses(code, name), term:terms(name)')
      .order('created_at')

    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*, instructor_profiles(*)')
      .eq('role', 'instructor')
      .order('full_name')

    const { data: assignmentsData, error } = await supabase
      .from('assignments')
      .select(`
        id,
        hours_assigned,
        instructor_id,
        section_id,
        instructor:profiles!assignments_instructor_id_fkey(id, full_name, email),
        section:sections!assignments_section_id_fkey(id, section_number, status, hours_required, day_of_week, time_slot, course:courses(code, name), term:terms(name))
      `)
      .is('draft_id', null)
      .neq('status', 'rejected')

    if (error) console.error('assignments error:', error)

    const { data: hoursData } = await supabase
      .from('assignments')
      .select('instructor_id, hours_assigned')
      .is('draft_id', null)
      .neq('status', 'rejected')

    const { data: availabilityData } = await supabase
      .from('instructor_availability')
      .select('instructor_id, day, time_slot')

    if (sectionsData) setSections(sectionsData as Section[])

    if (profilesData) {
      const withHours = profilesData.map(p => ({
        ...p,
        hoursAssigned: hoursData
          ? hoursData.filter(a => a.instructor_id === p.id).reduce((sum, a) => sum + a.hours_assigned, 0)
          : 0,
        maxHours: p.instructor_profiles?.max_hours_per_term || 40
      }))
      setInstructors(withHours as Instructor[])
    }

    if (assignmentsData) setAssignments(assignmentsData as unknown as Assignment[])
    if (availabilityData) setAvailability(availabilityData as AvailabilityRow[])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const selectedSectionObj = useMemo(
    () => sections.find(s => s.id === selectedSection) || null,
    [sections, selectedSection]
  )

  // Conflict reasons per instructor for the currently selected section — used to
  // flag conflicting instructors right in the dropdown before the admin even submits.
  const instructorConflicts = useMemo(() => {
    const map: Record<string, string[]> = {}
    if (!selectedSectionObj) return map
    for (const instructor of instructors) {
      map[instructor.id] = checkAssignmentConflicts({
        instructorName: instructor.full_name,
        targetSection: selectedSectionObj,
        existingAssignments: assignments.filter(a => a.instructor_id === instructor.id),
        unavailableSlots: availability.filter(a => a.instructor_id === instructor.id),
        hoursAlreadyAssigned: instructor.hoursAssigned,
        maxHoursPerTerm: instructor.maxHours
      })
    }
    return map
  }, [selectedSectionObj, instructors, assignments, availability])

  const activeConflicts = selectedInstructor ? (instructorConflicts[selectedInstructor] || []) : []

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSection || !selectedInstructor) {
      toast.error('Please select both a section and an instructor')
      return
    }

    const alreadyAssigned = assignments.find(a => a.section_id === selectedSection)
    if (alreadyAssigned) {
      toast.error('This section already has an instructor assigned')
      return
    }

    const section = sections.find(s => s.id === selectedSection)
    const instructor = instructors.find(i => i.id === selectedInstructor)
    if (!section || !instructor) return

    const conflicts = checkAssignmentConflicts({
      instructorName: instructor.full_name,
      targetSection: section,
      existingAssignments: assignments.filter(a => a.instructor_id === instructor.id),
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
      status: 'active'
    })

    if (error) {
      toast.error(error.message)
      setAssigning(false)
      return
    }

    await logAction(user!.id, 'assigned', 'assignment', undefined, {
      instructor: instructor.full_name,
      section: section.course.code + ' ' + section.section_number
    })

    await notifyInstructor(
      instructor.id,
      'notify_assigned',
      `You were assigned to ${section.course.code} Section ${section.section_number} (${formatDayTime(section.day_of_week, section.time_slot)}).`
    )

    toast.success('Instructor assigned!')
    setSelectedSection('')
    setSelectedInstructor('')
    setAssigning(false)
    fetchAll()
  }

  const handleRemove = async (id: string) => {
    const assignment = assignments.find(a => a.id === id)
    const { error } = await supabase.from('assignments').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'removed', 'assignment', id)
    if (assignment) {
      await notifyInstructor(
        assignment.instructor_id,
        'notify_unassigned',
        `You were removed from ${assignment.section.course.code} Section ${assignment.section.section_number}.`
      )
    }
    toast.success('Assignment removed!')
    fetchAll()
  }

  const statusColors: Record<string, { color: string; bg: string }> = {
    unassigned: { color: '#A32D2D', bg: '#FCEBEB' },
    partial: { color: '#854F0B', bg: '#FAEEDA' },
    filled: { color: '#0F6E56', bg: '#EAF3DE' },
  }

  const selectStyle = {
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

  const assignedSectionIds = assignments.map(a => a.section_id)

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Assignments
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Assign instructors to course sections
      </p>

      {/* Assign form */}
      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          New Assignment
        </h2>
        <form onSubmit={handleAssign}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Section
              </label>
              <select
                value={selectedSection}
                onChange={e => { setSelectedSection(e.target.value); setSelectedInstructor('') }}
                style={selectStyle}
              >
                <option value="">Select section...</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.course.code} — Section {s.section_number} ({s.hours_required}h, {formatDayTime(s.day_of_week, s.time_slot)}) {assignedSectionIds.includes(s.id) ? '✓ Assigned' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Instructor
              </label>
              <select value={selectedInstructor} onChange={e => setSelectedInstructor(e.target.value)} style={selectStyle}>
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
                  <li key={idx} style={{ fontSize: 13, color: '#A32D2D', marginBottom: 2 }}>
                    {reason}
                  </li>
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
            {assigning ? 'Assigning...' : 'Assign Instructor'}
          </button>
        </form>
      </div>

      {/* Assignments table */}
      <div style={{
        background: 'white', borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden'
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E' }}>
            Current Assignments ({assignments.length})
          </h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Course', 'Section', 'Term', 'Day / Time', 'Instructor', 'Hours', 'Status', ''].map(h => (
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
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>Loading...</td>
              </tr>
            ) : assignments.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                  No assignments yet. Use the form above to assign instructors.
                </td>
              </tr>
            ) : assignments.map(assignment => (
              <tr key={assignment.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                    {assignment.section.course.code}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                  Section {assignment.section.section_number}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#6B6B80' }}>
                  {assignment.section.term.name}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#1A1A2E' }}>
                  {formatDayTime(assignment.section.day_of_week, assignment.section.time_slot)}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                  {assignment.instructor.full_name}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                  {assignment.hours_assigned}h
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    background: statusColors[assignment.section.status]?.bg,
                    color: statusColors[assignment.section.status]?.color,
                    padding: '3px 10px', borderRadius: 20,
                    fontSize: 12, fontWeight: 600, textTransform: 'capitalize'
                  }}>
                    {assignment.section.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => handleRemove(assignment.id)}
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
    </div>
  )
}
