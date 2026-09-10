import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const faqs = [
  { q: 'How do I add a new course?', a: 'Go to the Courses page from the sidebar, fill in the course code, name, and optional description in the Add New Course form, then click Add Course.' },
  { q: 'How do I assign an instructor to a section?', a: 'Go to the Assignments page, select a section and an instructor from the dropdowns, then click Assign Instructor.' },
  { q: 'What does the Matching Engine do?', a: 'The Matching Engine automatically suggests the best instructor for each unassigned section using a weighted scoring algorithm.' },
  { q: 'How do I verify an instructor qualification?', a: 'Go to the Instructors page, expand an instructor card, and use the Verify button next to each qualification.' },
  { q: 'What is the difference between a draft and a live assignment?', a: 'Drafts are sandbox schedules private to admins. Live assignments are visible to instructors and coordinators.' },
  { q: 'How do I import courses or instructors in bulk?', a: 'Go to the Import page, choose a tab, then drag and drop a CSV file with the required columns.' },
  { q: 'Where can I see a history of changes?', a: 'The Audit Log page shows every action taken in CourseSync with filters by entity type.' },
]

const guides = [
  { title: 'Getting Started', items: ['Set up your terms and courses first', 'Create sections for each course', 'Add instructor accounts', 'Have instructors submit qualifications and preferences'] },
  { title: 'Managing Instructors', items: ['Add new instructors with department and title', 'Monitor workload bars', 'Verify qualifications before matching'] },
  { title: 'Running the Matching Engine', items: ['Ensure qualifications and preferences are set', 'Click Run Matching', 'Review suggestions', 'Accept and Publish'] },
  { title: 'Understanding Analytics', items: ['Fill Rate shows sections with confirmed instructors', 'Workload chart shows hours assigned vs max', 'Pie chart breaks down section status'] },
]

export default function AdminHelp() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Help and Support</h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>Guides and answers for common admin tasks</p>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>Guides</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {guides.map(guide => (
            <div key={guide.title} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 12 }}>{guide.title}</h3>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {guide.items.map((item, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#6B6B80', marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>Frequently Asked Questions</h2>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
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
      </div>

      <div style={{ background: '#EEEDFE', borderRadius: 12, padding: 20, border: '1px solid rgba(83,74,183,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 4 }}>Still need help?</div>
          <div style={{ fontSize: 13, color: '#534AB7' }}>Reach out to our support team and we will get back to you shortly.</div>
        </div>
        <a href="mailto:support@coursesync.ca" style={{ padding: '9px 20px', background: 'linear-gradient(135deg, #6C5FD6, #534AB7)', color: 'white', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}>
          Contact Support
        </a>
      </div>
    </div>
  )
}