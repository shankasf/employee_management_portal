'use client'

import React, { useRef, useCallback, useEffect, useMemo } from 'react'
import DOMPurify from 'dompurify'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
  required?: boolean
}

/**
 * RichTextEditor - A simple rich text editor with formatting toolbar
 *
 * Toolbar buttons:
 * - B: Bold
 * - I: Italic
 * - Bullet list
 * - Numbered list
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Enter text...',
  className = '',
  minHeight = '120px',
  required = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isInitializedRef = useRef(false)

  // Initialize editor content
  useEffect(() => {
    if (editorRef.current && !isInitializedRef.current) {
      editorRef.current.innerHTML = value || ''
      isInitializedRef.current = true
    }
  }, [value])

  // Update content when value changes externally (e.g., form reset)
  useEffect(() => {
    if (editorRef.current && value === '' && isInitializedRef.current) {
      editorRef.current.innerHTML = ''
    }
  }, [value])

  // Execute formatting command
  const execCommand = useCallback((command: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false)

    // Update the value after formatting
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }, [onChange])

  // Handle input changes
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }, [onChange])

  // Handle paste - strip complex formatting, keep basic HTML
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  return (
    <div className={`border-2 border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden focus-within:border-blue-500 transition-colors ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <ToolbarButton
          onClick={() => execCommand('bold')}
          title="Bold (Ctrl+B)"
        >
          <span className="font-bold text-base">B</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => execCommand('italic')}
          title="Italic (Ctrl+I)"
        >
          <span className="italic text-base">I</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

        <ToolbarButton
          onClick={() => execCommand('insertUnorderedList')}
          title="Bullet List"
        >
          <BulletListIcon />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => execCommand('insertOrderedList')}
          title="Numbered List"
        >
          <NumberedListIcon />
        </ToolbarButton>
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        className="px-4 py-3 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none overflow-auto rich-text-editor"
        style={{ minHeight }}
        onInput={handleInput}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        role="textbox"
        aria-required={required}
        aria-multiline="true"
      />
    </div>
  )
}

// Toolbar button component
function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-md text-sm transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  )
}

// Bullet list icon
function BulletListIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Numbered list icon
function NumberedListIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <text x="4" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui">1</text>
      <text x="4" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui">2</text>
      <text x="4" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui">3</text>
    </svg>
  )
}

/**
 * Display formatted HTML content (for viewing, not editing)
 * Sanitizes HTML to prevent XSS attacks
 */
export function RichTextDisplay({ content, className = '' }: { content: string; className?: string }) {
  const sanitized = useMemo(() => {
    if (!content) return ''
    return DOMPurify.sanitize(content, {
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
    })
  }, [content])

  if (!content) return null

  return (
    <div
      className={`rich-text-content ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}
