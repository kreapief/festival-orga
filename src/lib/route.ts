import { useEffect, useState } from 'react'

// Hash-Adressen (#/join/CODE) funktionieren bei jedem kostenlosen Hosting ohne Extra-Einstellungen
export type Route =
  | { name: 'join'; code: string }
  | { name: 'wieder'; token: string }
  | { name: 'gaeste' }
  | { name: 'app'; view: string; param?: string }

export function parseRoute(): Route {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/')
  if (a === 'join' && b) return { name: 'join', code: decodeURIComponent(b) }
  if (a === 'gaeste') return { name: 'gaeste' }
  if (a === 'wieder' && b) return { name: 'wieder', token: decodeURIComponent(b) }
  return { name: 'app', view: a || 'heute', param: b ? decodeURIComponent(b) : undefined }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute)
  useEffect(() => {
    const on = () => setRoute(parseRoute())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (view: string) => { location.hash = '/' + view }
export const appLink = (path: string) => `${location.origin}${location.pathname}#/${path}`
