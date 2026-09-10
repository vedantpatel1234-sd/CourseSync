import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import toast from 'react-hot-toast'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'

interface Section {
  id: string
  section_number: string
  hours_required: number
  course: { code: string; name: string }
  term: { name: string }
}

interface RankedSection extends Section {
  note: string
}

function SortableItem({ section, onRemove, onNoteChange }: {
  section: RankedSection
  rank: number
  onRemove: (id: string) => void
  onNoteChange: (id: string, note: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{
        background: 'white',
        borderRadius: 10,
        padding: '12px 16px',
        border: '1px solid rgba(83,74,183,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 8
      }}>
        <div {...attributes} {...listeners} style={{ cursor: 'grab', color: '#9ca3af', flexShrink: 0 }}>
          <GripVertical size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
              {section.course.code}
            </span>
            <span style={{ fontSize: 13, color: '#1A1A2E', fontWeight: 500 }}>
              Section {section.section_number}
            </span>
            <span style={{ fontSize: 12, color: '#6B6B80' }}>
              {section.term.name} • {section.hours_required}h
            </span>
          </div>
          <input
            value={section.note}
            onChange={e => onNoteChange(section.id, e.target.value)}
            placeholder="Add a note (optional)..."
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 7,
              border: '1px solid #e5e7eb',
              fontSize: 12,
              fontFamily: 'DM Sans, sans-serif',
              outline: 'none',
              color: '#6B6B80'
            }}
          />
        </div>
        <button
          onClick={() => onRemove(section.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', flexShrink: 0 }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export default function InstructorPreferences() {
  const { user } = useAuthStore()
  const [ranked, setRanked] = useState<RankedSection[]>([])
  const [available, setAvailable] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchData = async () => {
    if (!user) return

    const { data: sectionsData } = await supabase
      .from('sections')
      .select('*, course:courses(code, name), term:terms(name)')
      .order('created_at')

    const { data: prefsData } = await supabase
      .from('preferences')
      .select('*, section:sections(*, course:courses(code, name), term:terms(name))')
      .eq('instructor_id', user.id)
      .order('rank')

    if (prefsData && sectionsData) {
      const rankedIds = prefsData.map(p => p.section_id)
      const rankedSections = prefsData.map(p => ({
        ...p.section,
        note: p.note || ''
      })) as RankedSection[]

      const availableSections = (sectionsData as Section[]).filter(s => !rankedIds.includes(s.id))

      setRanked(rankedSections)
      setAvailable(availableSections)
    }

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [user])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setRanked(items => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const handleAdd = (section: Section) => {
    setRanked(prev => [...prev, { ...section, note: '' }])
    setAvailable(prev => prev.filter(s => s.id !== section.id))
  }

  const handleRemove = (id: string) => {
    const section = ranked.find(s => s.id === id)
    if (section) {
      setAvailable(prev => [...prev, section])
      setRanked(prev => prev.filter(s => s.id !== id))
    }
  }

  const handleNoteChange = (id: string, note: string) => {
    setRanked(prev => prev.map(s => s.id === id ? { ...s, note } : s))
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)

    await supabase.from('preferences').delete().eq('instructor_id', user.id)

    if (ranked.length > 0) {
      const rows = ranked.map((s, index) => ({
        instructor_id: user.id,
        section_id: s.id,
        rank: index + 1,
        note: s.note || null
      }))
      const { error } = await supabase.from('preferences').insert(rows)
      if (error) {
        toast.error(error.message)
        setSaving(false)
        return
      }
    }

    toast.success('Preferences saved!')
    setSaving(false)
  }

  if (loading) return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
            Preferences
          </h1>
          <p style={{ fontSize: 14, color: '#6B6B80' }}>
            Drag to rank your preferred sections
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: saving ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
            color: 'white', border: 'none', borderRadius: 9,
            fontSize: 14, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Ranked list */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
            Your Rankings ({ranked.length})
          </h2>
          {ranked.length === 0 ? (
            <div style={{
              background: 'white', borderRadius: 12, padding: 32,
              border: '1px dashed #e5e7eb', textAlign: 'center', color: '#6B6B80', fontSize: 14
            }}>
              Add sections from the right to rank them
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ranked.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {ranked.map((section, index) => (
                  <div key={section.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: '#534AB7', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 14
                    }}>
                      {index + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <SortableItem
                        section={section}
                        rank={index + 1}
                        onRemove={handleRemove}
                        onNoteChange={handleNoteChange}
                      />
                    </div>
                  </div>
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Available sections */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
            Available Sections ({available.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {available.length === 0 ? (
              <div style={{
                background: 'white', borderRadius: 12, padding: 32,
                border: '1px dashed #e5e7eb', textAlign: 'center', color: '#6B6B80', fontSize: 14
              }}>
                All sections have been ranked
              </div>
            ) : available.map(section => (
              <div key={section.id} style={{
                background: 'white', borderRadius: 10, padding: '12px 16px',
                border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                      {section.course.code}
                    </span>
                    <span style={{ fontSize: 13, color: '#1A1A2E', fontWeight: 500 }}>
                      Section {section.section_number}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6B6B80' }}>
                    {section.term.name} • {section.hours_required}h
                  </div>
                </div>
                <button
                  onClick={() => handleAdd(section)}
                  style={{
                    padding: '6px 14px', background: '#EEEDFE', color: '#534AB7',
                    border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', flexShrink: 0
                  }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}