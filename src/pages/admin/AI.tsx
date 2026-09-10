import { useState, useRef, useEffect } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, COPILOT_MODEL } from '../../lib/anthropic'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import {
  COPILOT_TOOLS,
  listUnassignedSections,
  findQualifiedInstructors,
  getInstructorWorkload,
  listSectionsTool,
  listAssignmentsTool,
  buildAssignmentPreview,
  buildDraftPreview,
  type FindInstructorsInput,
  type WorkloadInput,
  type ListSectionsInput,
  type AssignmentActionInput,
  type DraftActionInput,
  type AssignmentPreview,
  type DraftPreview
} from '../../lib/copilotTools'
import { Send } from 'lucide-react'
import toast from 'react-hot-toast'

const SYSTEM_PROMPT = `You are the Scheduling Copilot inside CourseSync, an academic scheduling tool used by administrators.

Rules you must follow:
- Never state a fact about sections, instructors, hours, availability, or assignments unless it came from a tool result in this conversation. If you don't have the data, call the relevant tool — never guess or estimate.
- To answer a question, call read-only tools first, then answer using only what they returned.
- To take an action that changes data (assigning an instructor, creating a draft), call the matching propose_* tool. Calling it does NOT execute the action — it only stages a preview the admin must confirm or cancel in the UI. Never claim an action was completed until a tool result explicitly confirms it with status "confirmed".
- If a tool result has status "blocked", briefly explain why and suggest an alternative if the data you already have suggests one — don't ask the admin to confirm something that's already blocked.
- If a tool result has status "cancelled", acknowledge it and stop — don't retry the same action.
- Day names are exactly: Monday, Tuesday, Wednesday, Thursday, Friday. Time slots are exactly: 8:00 AM, 9:00 AM, 10:00 AM, 11:00 AM, 12:00 PM, 1:00 PM, 2:00 PM, 3:00 PM, 4:00 PM. Treat "morning" as 8:00-11:00 AM and "afternoon" as 12:00-4:00 PM.
- Be concise and direct.`

const WELCOME_TEXT = `Hi! I'm your Scheduling Copilot. I can look up real data and, when you ask, stage changes for you to confirm — I never make changes on my own.

Try things like:
- "Show me unassigned sections and why"
- "Find a qualified available instructor for COMP2205 Tuesday morning"
- "Which instructor has the most hours remaining?"
- "Assign Dr. Smith to COMP1234 Section 01"
- "Create a draft called Winter Backup for Winter 2026"

What would you like to know?`

type DisplayMessage =
  | { id: string; kind: 'text'; role: 'user' | 'assistant'; content: string }
  | { id: string; kind: 'action'; preview: AssignmentPreview | DraftPreview; resolved: 'pending' | 'confirmed' | 'cancelled' | 'error'; resolvedMessage?: string }

interface PendingAction {
  actionMessageId: string
  toolUseId: string
  preview: AssignmentPreview | DraftPreview
  otherResults: Anthropic.ToolResultBlockParam[]
  baseMessages: Anthropic.MessageParam[]
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function executeReadOnlyTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case 'list_unassigned_sections':
      return listUnassignedSections()
    case 'find_qualified_instructors':
      return findQualifiedInstructors(input as FindInstructorsInput)
    case 'get_instructor_workload':
      return getInstructorWorkload(input as WorkloadInput)
    case 'list_sections':
      return listSectionsTool(input as ListSectionsInput)
    case 'list_assignments':
      return listAssignmentsTool()
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

export default function AdminAI() {
  const { user } = useAuthStore()
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([
    { id: uid(), kind: 'text', role: 'assistant', content: WELCOME_TEXT }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const apiMessagesRef = useRef<Anthropic.MessageParam[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayMessages, pendingAction])

  const runTurn = async (messages: Anthropic.MessageParam[], depth = 0) => {
    setLoading(true)
    try {
      if (depth > 8) {
        setDisplayMessages(prev => [...prev, {
          id: uid(), kind: 'text', role: 'assistant',
          content: 'This is taking a lot of steps — could you rephrase or narrow your request?'
        }])
        return
      }

      const response = await createMessage({
        model: COPILOT_MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: COPILOT_TOOLS,
        messages
      })

      const nextHistory: Anthropic.MessageParam[] = [...messages, { role: 'assistant', content: response.content }]
      apiMessagesRef.current = nextHistory

      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n\n')
        .trim()
      if (textParts) {
        setDisplayMessages(prev => [...prev, { id: uid(), kind: 'text', role: 'assistant', content: textParts }])
      }

      if (response.stop_reason !== 'tool_use') {
        return
      }

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const resolvedResults: Anthropic.ToolResultBlockParam[] = []
      let pending: { toolUseId: string; preview: AssignmentPreview | DraftPreview } | null = null

      for (const block of toolUseBlocks) {
        if (block.name === 'propose_assignment') {
          const preview = await buildAssignmentPreview(block.input as AssignmentActionInput)
          if ('error' in preview) {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(preview) })
          } else if (preview.blocked) {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'blocked', ...preview }) })
          } else if (!pending) {
            pending = { toolUseId: block.id, preview }
          } else {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'skipped', message: 'Only one action can be staged at a time; resolve the pending one first.' }) })
          }
        } else if (block.name === 'propose_create_draft') {
          const preview = await buildDraftPreview(block.input as DraftActionInput)
          if ('error' in preview) {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(preview) })
          } else if (preview.blocked) {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'blocked', ...preview }) })
          } else if (!pending) {
            pending = { toolUseId: block.id, preview }
          } else {
            resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'skipped', message: 'Only one action can be staged at a time; resolve the pending one first.' }) })
          }
        } else {
          const result = await executeReadOnlyTool(block.name, block.input)
          resolvedResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        }
      }

      if (pending) {
        const actionMessageId = uid()
        setPendingAction({
          actionMessageId,
          toolUseId: pending.toolUseId,
          preview: pending.preview,
          otherResults: resolvedResults,
          baseMessages: nextHistory
        })
        setDisplayMessages(prev => [...prev, { id: actionMessageId, kind: 'action', preview: pending!.preview, resolved: 'pending' }])
        return
      }

      const continuedMessages: Anthropic.MessageParam[] = [...nextHistory, { role: 'user', content: resolvedResults }]
      await runTurn(continuedMessages, depth + 1)
    } catch (err) {
      console.error(err)
      const detail = err instanceof Error ? err.message : 'Unknown error'
      setDisplayMessages(prev => [...prev, {
        id: uid(), kind: 'text', role: 'assistant',
        content: `Sorry, something went wrong talking to the assistant: ${detail}`
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading || pendingAction) return
    const userText = input.trim()
    setInput('')
    setDisplayMessages(prev => [...prev, { id: uid(), kind: 'text', role: 'user', content: userText }])
    const messages: Anthropic.MessageParam[] = [...apiMessagesRef.current, { role: 'user', content: userText }]
    await runTurn(messages)
  }

  const resolveAction = async (status: 'confirmed' | 'cancelled', resultPayload: Record<string, unknown>) => {
    if (!pendingAction) return
    const { toolUseId, otherResults, baseMessages, actionMessageId } = pendingAction

    setDisplayMessages(prev => prev.map(m =>
      m.id === actionMessageId && m.kind === 'action'
        ? { ...m, resolved: status === 'confirmed' ? (resultPayload.status === 'error' ? 'error' : 'confirmed') : 'cancelled', resolvedMessage: resultPayload.message as string | undefined }
        : m
    ))
    setPendingAction(null)

    const toolResult: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(resultPayload) }
    const continuedMessages: Anthropic.MessageParam[] = [...baseMessages, { role: 'user', content: [...otherResults, toolResult] }]
    await runTurn(continuedMessages)
  }

  const handleConfirm = async () => {
    if (!pendingAction || !user) return
    setConfirming(true)
    const { preview } = pendingAction

    if (preview.kind === 'assignment') {
      const { error } = await supabase.from('assignments').insert({
        instructor_id: preview.instructorId,
        section_id: preview.sectionId,
        hours_assigned: preview.hours,
        assigned_by: user.id,
        status: 'active'
      })
      if (error) {
        toast.error(error.message)
        await resolveAction('confirmed', { status: 'error', message: error.message })
      } else {
        await logAction(user.id, 'assigned', 'assignment', undefined, {
          instructor: preview.instructorName, section: preview.sectionLabel, via: 'copilot'
        })
        await notifyInstructor(
          preview.instructorId,
          'notify_assigned',
          `You were assigned to ${preview.sectionLabel} (${preview.dayTime}).`
        )
        toast.success('Assignment created!')
        await resolveAction('confirmed', { status: 'confirmed', message: `${preview.instructorName} was assigned to ${preview.sectionLabel}.` })
      }
    } else {
      const { error } = await supabase.from('drafts').insert({
        name: preview.name,
        term_id: preview.termId,
        created_by: user.id,
        status: 'sandbox',
        is_ai_generated: true
      })
      if (error) {
        toast.error(error.message)
        await resolveAction('confirmed', { status: 'error', message: error.message })
      } else {
        await logAction(user.id, 'created', 'draft', undefined, { name: preview.name, via: 'copilot' })
        toast.success('Draft created!')
        await resolveAction('confirmed', { status: 'confirmed', message: `Draft "${preview.name}" was created for ${preview.termName}.` })
      }
    }
    setConfirming(false)
  }

  const handleCancel = async () => {
    if (!pendingAction) return
    await resolveAction('cancelled', { status: 'cancelled', message: 'The admin declined this action.' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const renderPreview = (preview: AssignmentPreview | DraftPreview) => {
    if (preview.kind === 'assignment') {
      return (
        <>
          <div style={{ fontSize: 13, color: '#6B6B80', marginBottom: 2 }}>Assign instructor</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 8 }}>
            {preview.instructorName} → {preview.sectionLabel}
          </div>
          <div style={{ fontSize: 13, color: '#6B6B80' }}>
            {preview.dayTime} · {preview.hours}h
          </div>
        </>
      )
    }
    return (
      <>
        <div style={{ fontSize: 13, color: '#6B6B80', marginBottom: 2 }}>Create draft</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 8 }}>
          {preview.name}
        </div>
        <div style={{ fontSize: 13, color: '#6B6B80' }}>
          {preview.termName} · sandbox — invisible to instructors/coordinators until published
        </div>
      </>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'white' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
          Scheduling Copilot
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80' }}>
          Ask about your scheduling data, or ask it to stage an assignment or draft for your review
        </p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayMessages.map(msg => {
          if (msg.kind === 'text') {
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '70%',
                  padding: '12px 16px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? '#534AB7' : 'white',
                  color: msg.role === 'user' ? 'white' : '#1A1A2E',
                  fontSize: 14,
                  lineHeight: 1.6,
                  border: msg.role === 'assistant' ? '1px solid rgba(0,0,0,0.07)' : 'none',
                  whiteSpace: 'pre-wrap'
                }}>
                  {msg.content}
                </div>
              </div>
            )
          }

          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                maxWidth: '80%',
                padding: 16,
                borderRadius: 14,
                background: '#EEEDFE',
                border: '1px solid rgba(83,74,183,0.25)'
              }}>
                {renderPreview(msg.preview)}

                {msg.resolved === 'pending' ? (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      onClick={handleConfirm}
                      disabled={confirming}
                      style={{
                        padding: '8px 18px',
                        background: confirming ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                        color: 'white', border: 'none', borderRadius: 8,
                        fontSize: 13, fontWeight: 600,
                        cursor: confirming ? 'not-allowed' : 'pointer',
                        fontFamily: 'DM Sans, sans-serif'
                      }}
                    >
                      {confirming ? 'Working...' : 'Confirm'}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={confirming}
                      style={{
                        padding: '8px 18px',
                        background: 'white', color: '#6B6B80',
                        border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
                        fontSize: 13, fontWeight: 600,
                        cursor: confirming ? 'not-allowed' : 'pointer',
                        fontFamily: 'DM Sans, sans-serif'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{
                    marginTop: 12, fontSize: 12, fontWeight: 600,
                    color: msg.resolved === 'confirmed' ? '#0F6E56' : msg.resolved === 'error' ? '#A32D2D' : '#6B6B80'
                  }}>
                    {msg.resolved === 'confirmed' && '✓ Confirmed'}
                    {msg.resolved === 'cancelled' && '✗ Cancelled'}
                    {msg.resolved === 'error' && `✗ Failed: ${msg.resolvedMessage || 'Unknown error'}`}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '16px 16px 16px 4px',
              background: 'white',
              border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)',
              color: '#6B6B80',
              fontSize: 14
            }}>
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '16px 32px',
        borderTop: '1px solid rgba(0,0,0,0.07)',
        background: 'white',
        display: 'flex',
        gap: 12
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={pendingAction ? 'Resolve the pending action above first...' : 'Ask something about your schedule...'}
          disabled={!!pendingAction}
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: 10,
            border: '1.5px solid #e5e7eb',
            fontSize: 14,
            fontFamily: 'DM Sans, sans-serif',
            outline: 'none',
            color: '#1A1A2E',
            background: pendingAction ? '#f8f8f8' : 'white'
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim() || !!pendingAction}
          style={{
            padding: '12px 20px',
            background: (loading || !input.trim() || pendingAction) ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
            color: 'white',
            border: 'none',
            borderRadius: 10,
            cursor: (loading || !input.trim() || pendingAction) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          <Send size={16} />
          Send
        </button>
      </div>
    </div>
  )
}
