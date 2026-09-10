import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const faqs = [
  { q: 'How do I see my current assignments?', a: 'Go to My Assignments from the sidebar to see all sections you are currently teaching, along with your total hours and remaining capacity.' },
  { q: 'How do I add a qualification?', a: 'Go to Qualifications, find the course you are qualified to teach, and click Add. An admin will need to verify it before it counts toward matching.' },
  { q: 'How does ranking preferences work?', a: 'Go to Preferences and drag sections from the Available list into your Rankings list. Drag to reorder — position 1 is your top choice. Do not forget to click Save.' },
  { q: 'How do I set my availability?', a: 'Go to Availability and click any time slot to mark it as unavailable (shown in red). Click Save Availability when done.' },
  { q: 'Can I change my notification preferences?', a: 'Yes, go to Notifications and toggle which alerts you want to receive, then click Save Preferences.' },
]

export default function InstructorHelp() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Help and Support</h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>Answers to common questions</p>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 24 }}>
        {faqs.map((faq, i) => (
          <div key={i} style={{ borderBottom: i < faqs.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'DM Sans, sans-serif' }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, color: '#1A1A2E' }}>{faq.q}</span>
              <ChevronDown size={18} color="#6B6B80" style={{ transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
            </button>
            {openFaq === i && (
              <div style={{ padding: '0 20px 16px', fontSize: 13, color: '#6B6B80', lineHeight: 1.6 }}>{faq.a}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: '#EEEDFE', borderRadius: 12, padding: 20, border: '1px solid rgba(83,74,183,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 4 }}>Still need help?</div>
          <div style={{ fontSize: 13, color: '#534AB7' }}>Reach out to our support team and we will get back to you shortly.</div>
        </div>
        <a href="mailto:support@coursesync.ca" style={{ padding: '9px 20px', background: '#534AB7', color: 'white', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}>
          Contact Support
        </a>
      </div>
    </div>
  )
}