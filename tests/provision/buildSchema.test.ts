// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { buildSchema } from '../../scripts/buildSchema.mjs'

const file = (name: string, sql = `-- ${name}\nSELECT 1;`) => ({ name, sql })

describe('buildSchema', () => {
  it('joins the migrations in numeric order, labelled, regardless of the order given', () => {
    const out = buildSchema([file('002_b.sql'), file('000_baseline.sql'), file('001_a.sql')])
    const order = [...out.matchAll(/==================== (\S+) ====================/g)].map(m => m[1])
    expect(order).toEqual(['000_baseline.sql', '001_a.sql', '002_b.sql'])
  })

  it('starts with a warning that it is only for new, empty projects', () => {
    const out = buildSchema([file('000_baseline.sql')])
    expect(out).toMatch(/NEW, EMPTY Supabase project/)
    expect(out).toMatch(/do NOT run it on a project that already has CourseSync tables/)
  })

  it('keeps each migration\'s SQL intact', () => {
    const out = buildSchema([file('000_baseline.sql', 'CREATE TABLE a (id int);'), file('001_x.sql', 'ALTER TABLE a ADD b int;')])
    expect(out).toContain('CREATE TABLE a (id int);')
    expect(out).toContain('ALTER TABLE a ADD b int;')
  })

  it('refuses an empty list', () => {
    expect(() => buildSchema([])).toThrow(/No migrations/)
  })

  it('refuses a gap in the numbering, because a missing migration would silently change the result', () => {
    expect(() => buildSchema([file('000_baseline.sql'), file('002_b.sql')])).toThrow(/not consecutive: 000_baseline.sql is followed by 002_b.sql/)
  })

  it('refuses duplicate numbers', () => {
    expect(() => buildSchema([file('000_baseline.sql'), file('001_a.sql'), file('001_b.sql')])).toThrow(/share the same number/)
  })

  it('refuses a file without a number', () => {
    expect(() => buildSchema([file('000_baseline.sql'), file('notes.sql')])).toThrow(/three-digit number: notes.sql/)
  })

  it('refuses to start anywhere but the baseline', () => {
    expect(() => buildSchema([file('001_a.sql'), file('002_b.sql')])).toThrow(/first migration must be 000_baseline/)
  })
})
