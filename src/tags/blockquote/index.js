import AbstractTag from '../AbstractTag.js'
import meta from './meta.js'

class Blockquote extends AbstractTag {
  constructor (quillJS, options = {}) {
    super()
    this.quillJS = quillJS
    this.name = 'blockquote'
    this.pattern = this._getCustomPatternOrDefault(options, this.name, /^(>).*/gm)
    this.getAction.bind(this)
    this._meta = meta()
    this.activeTags = this._getActiveTagsWithoutIgnore(this._meta.applyHtmlTags, options.ignoreTags)
  }

  getAction () {
    return {
      name: this.name,
      pattern: this.pattern,
      action: (text, selection, pattern, lineState) => new Promise((resolve) => {
        const match = pattern.exec(text)
        if (!match || !this.activeTags.length) {
          resolve(false)
          return
        }

        const originalText = match[0] || ''
        setTimeout(() => {
          const startIndex = selection.index - originalText.length

          var newline = ''
          // If there was some existing text on the current line, start at new line for code block
          if (lineState != startIndex) {
            newline = '\n'
          }
  
          this.quillJS.deleteText(startIndex, originalText.length)
          setTimeout(() => {
            this.quillJS.insertText(startIndex, newline)
            const newLinePosition = startIndex + 1 + newline.length + 1
            this.quillJS.formatLine(newLinePosition - 2, 1, 'blockquote', true)
            resolve(true)
          }, 0)
        }, 0)
      }),
      release: () => {
        setTimeout(() => {
          const cursorIndex = this.quillJS.getSelection().index
          const block = this.quillJS.getLine(cursorIndex)[0]
          const blockText = block.domNode.textContent
          if (block && blockText && blockText.replace('\n', '').length <= 0) {
            this.quillJS.format('blockquote', false)
          }
        }, 0)
      }
    }
  }
}

export default Blockquote
