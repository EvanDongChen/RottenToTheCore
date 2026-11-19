import { useMemo } from 'react'
import { useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Renders text with every fruit's name in bold, tinted with that fruit's colour. */
export default function RichText({ text }: { text: string }) {
  // Only names and kinds matter here; joined into a string so the selector result is stable.
  const key = useSim((s) => s.fruits.map((f) => `${f.name}\t${f.kind}`).join('\n'))

  const { pattern, colors } = useMemo(() => {
    const entries = key
      .split('\n')
      .map((row) => row.split('\t'))
      .filter(([name]) => name.trim())
    const colors = new Map(entries.map(([name, kind]) => [name.toLowerCase(), LOOKS[kind as keyof typeof LOOKS].color]))
    // Longest first, so "Pippa" wins over "Pip".
    const names = entries.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length)
    return { pattern: names.length ? new RegExp(`\\b(${names.join('|')})\\b`, 'gi') : null, colors }
  }, [key])

  if (!pattern) return <>{text}</>
  return (
    <>
      {text.split(pattern).map((part, i) =>
        // split() with one capture group puts the matched names at the odd indexes.
        i % 2 ? (
          <b key={i} className="fruit-name" style={{ '--fruit': colors.get(part.toLowerCase()) } as React.CSSProperties}>
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </>
  )
}
