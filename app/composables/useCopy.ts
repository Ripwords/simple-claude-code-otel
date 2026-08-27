export type CopyState = 'idle' | 'copied' | 'manual'

/**
 * The clipboard API rejects on an unfocused document and is absent outside a
 * secure context. Neither case may leave the operator with no way to take the
 * token, so the fallback selects the text and says which keys to press.
 */
export function useCopy(resetMs = 2400) {
  const state = ref<CopyState>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined

  function settle(next: CopyState) {
    state.value = next
    clearTimeout(timer)
    if (next !== 'manual') timer = setTimeout(() => (state.value = 'idle'), resetMs)
  }

  function selectAll(node: HTMLElement | null) {
    if (!node) return
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  async function copy(text: string, fallbackNode?: HTMLElement | null) {
    try {
      await navigator.clipboard.writeText(text)
      settle('copied')
    } catch {
      selectAll(fallbackNode ?? null)
      settle('manual')
    }
  }

  onScopeDispose(() => clearTimeout(timer))

  return { state, copy }
}
