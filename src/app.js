import 'regenerator-runtime'

import TagsOperators from './tags/index.js'

class MarkdownActivity {
  constructor (quillJS, options = {}) {
    this.quillJS = quillJS
    this.options = options
    this.onTextChangeBound = this.onTextChange.bind(this)
    this.quillJS.on('text-change', this.onTextChangeBound)
    this.actionCharacters = {
      whiteSpace: ' ',
      newLine: '\n',
      asterisk: '*',
      rightParenthesis: ')',
      grave: '`',
      tilde: '~',
      underscore: '_'
    }
    this.ignoreTags = ['PRE', ...(options.ignoreTags || [])]
    this.tags = new TagsOperators(this.quillJS, options)
    this.matches = this.tags.getOperatorsAll()
    this.fullMatches = this.tags.getFullTextOperatorsAll()
  }

  destroy () {
    this.quillJS.off('text-change', this.onTextChangeBound)
  }

  onTextChange (delta, oldContents, source) {
    if (source !== 'user') return

    const selection = this.quillJS.getSelection()
    const [line, offset] = this.quillJS.getLine(selection.index)
    const lineStart = selection.index - offset

    if (this.wasLineDeleted(delta, oldContents)) {
      // Check if the old attributes at the current position were not same
      // For example if you have code block with 2 lines, and you delete the second line
      // it should not remove the codeblock, since line 1 still had code block
      const oldAttrsAtCurrentIndex = this.getAttributeInDeltaAtIndex(selection.index, oldContents)
      if (oldAttrsAtCurrentIndex && (oldAttrsAtCurrentIndex['blockquote'] || oldAttrsAtCurrentIndex['code-block'])) {
      } else {
        const rangeElements = ['PRE', 'BLOCKQUOTE']
        const [removeLine] = this.quillJS.getLine(selection.index)
        if (rangeElements.includes(removeLine.domNode.tagName)) {
          this.quillJS.formatLine(lineStart, selection.index-lineStart, 'code-block', false)
          this.quillJS.formatLine(lineStart, selection.index-lineStart, 'blockquote', false)
        }   
      }
    }

    const inputText = delta.ops[0].insert || (delta.ops[1] && delta.ops[1].insert)
    if (!inputText) return
    if (inputText.length > 1) {
      setTimeout(async () => {
        const cursorOffset = (delta.ops[0] && delta.ops[0].retain) || 0
        const cursorOffsetFixed = cursorOffset
        const tokens = inputText.split('\n')
        let _offset = cursorOffsetFixed
        // eslint-disable-next-line no-unused-vars
        for (let v of tokens) {
          const [line] = this.quillJS.getLine(_offset)
          if (!line) {
            return 0
          }
          const firstIndex = this.quillJS.getIndex(line)
          let _targetText = ''
          let result = await this.onFullTextExecute.bind(this)({ index: firstIndex, delta, length: 0 })

          if (result) {
            while (result) {
              const [line] = this.quillJS.getLine(_offset)
              const firstIndex = this.quillJS.getIndex(line)
              if (!line || !(line.domNode)) {
                result = false
                break
              }

              _targetText = line.domNode.textContent || ''
              result = await this.onFullTextExecute.bind(this)({ index: firstIndex, delta, length: 0 })
            }
          } else {
            _targetText = line.domNode.textContent || ''
          }
          _offset += _targetText.length + 1
        }
      }, 0)
      return
    }

    delta.ops.filter(e => e.hasOwnProperty('insert')).forEach(e => {
      switch (e.insert) {
        case this.actionCharacters.whiteSpace:
        case this.actionCharacters.rightParenthesis:
        case this.actionCharacters.asterisk:
        case this.actionCharacters.grave:
        case this.actionCharacters.newLine:
        case this.actionCharacters.tilde:
        case this.actionCharacters.underscore:
          this.onInlineExecute.bind(this)()
          break
      }
    })

    delta.ops.filter(e => e.hasOwnProperty('delete')).forEach((e) => {
      this.onRemoveElement(e)
    })
  }

  onInlineExecute () {
    const selection = this.quillJS.getSelection()
    if (!selection) return
    // Skip if inside a code block
    const [line, offset] = this.quillJS.getLine(selection.index)
    const lineStart = selection.index - offset
    const format = this.quillJS.getFormat(lineStart)

    const text = this.getTextBeforeCursor()
    for (let match of this.matches) {
      const matchedText = typeof match.pattern === 'function' ? match.pattern(text) : text.match(match.pattern)
      if (matchedText) {
        match.action(text, selection, match.pattern, lineStart)
        return
      }
    }
  }

  getTextBeforeCursor() {
    const selection = this.quillJS.getSelection()
    if (!selection) return ''
    return this.getTextFromDelta(this.quillJS.getContents(0, selection.index))
  }

  getTextFromDelta(delta) {
    if (!delta) {
      return ''
    }
    return delta.map(op => {
      if (typeof op.insert === 'string') {
        return op.insert
      } else if (op.insert.mention) {
        return ' '
      } else {
        return ''
      }
    })
    .join('');
  }

  getAttributeInDeltaAtIndex(index, delta) {
    if (!delta) {
      return null
    }
    let currentIndex = 0
    for (var i = 0; i < delta.ops.length; i++) {
      const op = delta.ops[i]

      let deltaLength = 0
      if (typeof op.insert === 'string'){
        deltaLength = op.insert.length
      } else if (op.insert.mention) {
        deltaLength = 1
      }
      if (index >= currentIndex && index < (currentIndex+deltaLength) ) {
        return op.attributes
      }
      currentIndex += deltaLength
    }

    return null
  }

  wasLineDeleted(delta, oldDelta) {
    const oldtext = this.getTextFromDelta(oldDelta)
    const selection = this.quillJS.getSelection()
    const isLastCharNewLine = oldtext.charAt(selection.index) == "\n"
    const isRemoveCommand = delta.ops.find(e => e.hasOwnProperty('delete')) 
    return isRemoveCommand && isLastCharNewLine
  }

  async onFullTextExecute (virtualSelection) {
    let selection = virtualSelection || this.quillJS.getSelection()
    const delta = virtualSelection.delta
    if (!selection) return false
    const [line, offset] = this.quillJS.getLine(selection.index)

    if (!line || offset < 0) return false
    const retain = (delta && delta.ops && delta.ops[0].retain) || 0
    const lineStart = selection.index - offset
    const formatLineStart = retain ? retain - 1 : lineStart
    const format = this.quillJS.getFormat(formatLineStart)
    if (format['code-block'] || format['code']) {
      // if exists text in code-block, to skip.

      if (format['code']) {
        // ignore all styles when copied text in code block.
        const copiedTexts = delta.ops.filter(d => d.insert).map(d => d.insert).join('')
        this.quillJS.deleteText(retain, copiedTexts.length)
        this.quillJS.insertText(retain, copiedTexts.replace(/\n/g, ''), { code: true })
        this.quillJS.format('code', false)
      }
      return false
    }
    const beforeNode = this.quillJS.getLine(lineStart - 1)[0]
    const beforeLineText = beforeNode && beforeNode.domNode.textContent
    const text = line.domNode.textContent + ' '
    selection.length = selection.index++
    // remove block rule.
    if (typeof beforeLineText === 'string' && beforeLineText.length > 0 && text === ' ') {
      const releaseTag = this.fullMatches.find(e => e.name === line.domNode.tagName.toLowerCase())
      if (releaseTag && releaseTag.release) {
        releaseTag.release(selection)
        return false
      }
    }

    for (let match of this.fullMatches) {
      const matchedText = typeof match.pattern === 'function' ? match.pattern(text) : text.match(match.pattern)
      if (matchedText) {
        // eslint-disable-next-line no-return-await
        return await match.action(text, selection, match.pattern, lineStart)
      }
    }
    return false
  }

  onRemoveElement (range) {
    const selection = this.quillJS.getSelection()
    // if removed one item before, editor need to clear item.
    if (range && range.delete === 1) {
      const removeItem = this.quillJS.getLine(selection.index)
      const lineItem = removeItem[0]
      const releaseTag = this.matches.find(e => e.name === lineItem.domNode.tagName.toLowerCase())
      if (releaseTag && releaseTag.release) {
        releaseTag.release(selection)
      }
    }
  }
}

export default MarkdownActivity
