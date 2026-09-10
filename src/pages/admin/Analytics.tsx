import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend
} from 'recharts'

interface SectionStat {
  status: string
}

interface InstructorStat {
  full_name: string
  hoursAssigned: number
  maxHours: number
}

export default function AdminAnalytics() {
  const [sections, setSections] = useState<SectionStat[]>([])
  const [instructors, setInstructors] = useState<InstructorStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      const { data: sectionsData } = await supabase
        .from('sections')
        .select('status')

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*, instructor_profiles(*)')
        .eq('role', 'instructor')
        .order('full_name')

      const { data: assignmentsData } = await supabase
        .from('assignments')
        .select('instructor_id, hours_assigned')
        .is('draft_id', null)
        .neq('status', 'rejected')

      if (sectionsData) setSections(sectionsData)

      if (profilesData) {
        const result = profilesData.map(p => ({
          full_name: p.full_name.split(' ').slice(0, 2).join(' '),
          hoursAssigned: assignmentsData
            ? assignmentsData.filter(a => a.instructor_id === p.id).reduce((sum, a) => sum + a.hours_assigned, 0)
            : 0,
          maxHours: p.instructor_profiles?.max_hours_per_term || 40
        }))
        setInstructors(result)
      }

      setLoading(false)
    }
    fetchData()
  }, [])

  const filled = sections.filter(s => s.status === 'filled').length
  const partial = sections.filter(s => s.status === 'partial').length
  const unassigned = sections.filter(s => s.status === 'unassigned').length
  const total = sections.length
  const fillRate = total > 0 ? Math.round((filled / total) * 100) : 0

  const pieData = [
    { name: 'Filled', value: filled, color: '#0F6E56' },
    { name: 'Partial', value: partial, color: '#854F0B' },
    { name: 'Unassigned', value: unassigned, color: '#A32D2D' },
  ].filter(d => d.value > 0)

  const workloadData = instructors.map(i => ({
    name: i.full_name,
    Assigned: i.hoursAssigned,
    Remaining: Math.max(i.maxHours - i.hoursAssigned, 0)
  }))

  if (loading) return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Analytics
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Winter 2026 scheduling overview
      </p>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Total Sections', value: total, color: '#534AB7', bg: '#EEEDFE' },
          { label: 'Fill Rate', value: `${fillRate}%`, color: '#0F6E56', bg: '#EAF3DE' },
          { label: 'Instructors', value: instructors.length, color: '#854F0B', bg: '#FAEEDA' },
          { label: 'Unassigned', value: unassigned, color: '#A32D2D', bg: '#FCEBEB' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'white', borderRadius: 12, padding: 20,
            border: '1px solid rgba(0,0,0,0.07)'
          }}>
            <div style={{
              display: 'inline-block', padding: '4px 10px',
              borderRadius: 20, background: card.bg,
              color: card.color, fontSize: 12,
              fontWeight: 600, marginBottom: 12
            }}>
              {card.label}
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: card.color }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* Workload bar chart */}
        <div style={{
          background: 'white', borderRadius: 12, padding: 24,
          border: '1px solid rgba(0,0,0,0.07)'
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 20 }}>
            Instructor Workload
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={workloadData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B6B80' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B6B80' }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Assigned" stackId="a" fill="#534AB7" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Remaining" stackId="a" fill="#EEEDFE" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Section status pie chart */}
        <div style={{
          background: 'white', borderRadius: 12, padding: 24,
          border: '1px solid rgba(0,0,0,0.07)'
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 20 }}>
            Section Fill Status
          </h2>
          {pieData.length === 0 ? (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6B80' }}>
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}