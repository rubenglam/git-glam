import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Copy, X } from 'lucide-react'

export function ErrorNotification({ message, onClose }: { message: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return <div className="notification notification-error" role="alert">
    <CircleAlert className="notification-icon" size={20} aria-hidden="true"/>
    <span className="notification-message">{message}</span>
    <div className="notification-actions">
      <button type="button" aria-label={copied ? 'Error copiado' : 'Copiar error'} title={copied ? 'Copiado' : 'Copiar error'} onClick={() => void copy()}>
        {copied ? <Check size={16} aria-hidden="true"/> : <Copy size={16} aria-hidden="true"/>}
      </button>
      <button type="button" aria-label="Cerrar aviso de error" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </div>
  </div>
}
