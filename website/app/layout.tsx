import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Git Glam — Tu historial, a simple vista',
  description: 'Explora tu historial Git, ramas y cambios en una interfaz clara para Windows.',
  icons: { icon: '/logo.svg' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>
}
