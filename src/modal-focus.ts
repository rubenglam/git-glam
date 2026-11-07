const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

// Keep focus inside the topmost modal and return it to its opener when closed.
export function installModalFocus() {
  let previousFocus: HTMLElement | null = null
  let stack: { element: HTMLElement; opener: HTMLElement | null }[] = []
  const focusable = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'))
  document.addEventListener('focusin', event => {
    const target = event.target as HTMLElement
    if (!target.closest('[aria-modal="true"]') || stack.some(entry => entry.element.contains(target))) previousFocus = target
  })
  const observer = new MutationObserver(() => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    while (stack.length && !dialogs.includes(stack[stack.length - 1].element)) {
      const closed = stack.pop()!
      if (closed.opener?.isConnected) closed.opener.focus()
    }
    for (const dialog of dialogs) {
      if (stack.some(entry => entry.element === dialog)) continue
      const active = document.activeElement as HTMLElement | null
      const opener = active && !dialog.contains(active) ? active : previousFocus
      stack.push({ element: dialog, opener })
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
      if (!dialog.contains(document.activeElement)) (focusable(dialog)[0] || dialog).focus()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !stack.length) return
    const dialog = stack[stack.length - 1].element, elements = focusable(dialog)
    if (!elements.length) { event.preventDefault(); dialog.focus(); return }
    const index = elements.indexOf(document.activeElement as HTMLElement)
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === elements.length - 1)) {
      event.preventDefault(); elements[event.shiftKey ? elements.length - 1 : 0].focus()
    }
  }, true)
}
