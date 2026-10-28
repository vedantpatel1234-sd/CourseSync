import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LEGAL_DOCS, LEGAL_STATUS, TERMS_VERSION, isLegalDocId } from '../legal'
import type { LegalDocId } from '../legal'
import { usePageTitle } from '../lib/pageTitles'

const ORDER: LegalDocId[] = ['terms', 'privacy', 'subprocessors', 'dpa', 'security']

// Public (no sign-in) pages for the Terms of Service, Privacy Policy and related documents.
// The text lives in src/legal/content/*.md so it can be reviewed and edited as plain documents.
export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>()
  usePageTitle(isLegalDocId(doc) ? LEGAL_DOCS[doc].title : 'Document not found')

  return (
    <div role="main" style={{ minHeight: '100vh', padding: '32px 20px', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <Link to="/login" style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E', textDecoration: 'none' }}>🎓 CourseSync</Link>
          <nav aria-label="Legal documents" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {ORDER.map(id => (
              <Link key={id} to={`/legal/${id}`} aria-current={doc === id ? 'page' : undefined}
                style={{ fontSize: 13, color: '#534AB7', fontWeight: doc === id ? 700 : 500 }}>
                {LEGAL_DOCS[id].title}
              </Link>
            ))}
          </nav>
        </div>

        {LEGAL_STATUS === 'draft' && (
          <div role="note" style={{
            background: '#FAEEDA', color: '#854F0B', border: '1px solid rgba(133,79,11,0.25)',
            borderRadius: 10, padding: '12px 16px', fontSize: 13, marginBottom: 20, lineHeight: 1.5
          }}>
            <strong>Draft, not yet in effect.</strong> This document is awaiting legal review. Text in [BRACKETS] is a placeholder.
          </div>
        )}

        <article className="legal-doc" style={{
          background: 'white', borderRadius: 14, padding: '32px 36px',
          border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)'
        }}>
          {isLegalDocId(doc) ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // In-app links stay in the single-page app; everything else opens safely in a new tab.
                a: ({ href, children }) => href?.startsWith('/')
                  ? <Link to={href}>{children}</Link>
                  : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              }}
            >
              {LEGAL_DOCS[doc].body}
            </ReactMarkdown>
          ) : (
            <>
              <h1>Document not found</h1>
              <p>That page doesn't exist. Choose one of the documents above.</p>
            </>
          )}
        </article>

        <p style={{ fontSize: 12, color: '#6B6B80', textAlign: 'center', marginTop: 16 }}>
          Terms version {TERMS_VERSION}
        </p>
      </div>
    </div>
  )
}
