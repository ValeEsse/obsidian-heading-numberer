const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const STYLE_OPTIONS = {
  '1': '阿拉伯数字 (1, 2, 3...)',
  'a': '小写字母 (a, b, c...)',
  'A': '大写字母 (A, B, C...)',
  'i': '小写罗马数字 (i, ii, iii...)',
  'I': '大写罗马数字 (I, II, III...)',
  '一': '大写中文数字 (一, 二, 三...)',
  '①': '带圈阿拉伯数字 (①, ②, ③...)',
};

const DEFAULT_SETTINGS = {
  startLevel: 1,
  depth: 8,
  removeExisting: true,
  // 是否在次级标题前添加首级序号（例如：在次级前显示 "一、1" 而非仅显示 "1"）
  prependParentNumber: true,
  // 是否在标题改变时自动重新生成序号
  autoGenerateOnChange: false,
  // 为每一级存储配置：[{ style: '1', displayFormat: '{}', separator: '.' }, ...]
  // 默认不设分隔符（允许为空字符串），可在设置中自定义为 '.'、'、' 等
  levelConfigs: [
    { style: '1', displayFormat: '{}', separator: '' },
    { style: 'a', displayFormat: '{}', separator: '' },
    { style: 'i', displayFormat: '{}', separator: '' },
    { style: 'A', displayFormat: '{}', separator: '' },
    { style: 'I', displayFormat: '{}', separator: '' },
    { style: '一', displayFormat: '{}', separator: '' },
    { style: '1', displayFormat: '{}', separator: '' },
    { style: 'a', displayFormat: '{}', separator: '' }
  ]
};

class HeadingNumbererPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // 添加命令：为当前笔记生成标题序号
    this.addCommand({
      id: 'heading-numberer-generate',
      name: '生成标题序号',
      editorCallback: (editor, view) => {
        this.generateHeadingNumbers(editor);
      }
    });

    // 添加命令：移除标题序号
    this.addCommand({
      id: 'heading-numberer-remove',
      name: '移除标题序号',
      editorCallback: (editor, view) => {
        this.removeHeadingNumbers(editor);
      }
    });

    // 添加设置面板
    this.addSettingTab(new HeadingNumbererSettingTab(this.app, this));

    // 如果启用了自动生成，为每个文件的编辑器注册 modify 事件
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, info) => {
        if (this.settings.autoGenerateOnChange) {
          // 获取当前活动的文件
          const activeFile = this.app.workspace.getActiveFile();
          if (activeFile && activeFile.extension === 'md') {
            // 检查修改是否发生在标题行
            const isHeadingModified = this._isHeadingModified(editor, info);
            
            if (isHeadingModified) {
              // 在下一个事件循环中执行，避免在编辑过程中频繁触发
              if (this.autoGenerateTimeout) {
                clearTimeout(this.autoGenerateTimeout);
              }
              this.autoGenerateTimeout = setTimeout(() => {
                this.generateHeadingNumbers(editor);
              }, 500); // 500ms 防抖延迟
            }
          }
        }
      })
    );
  }

  // 检查修改是否发生在标题行
  _isHeadingModified(editor, info) {
    try {
      // info.changes 包含所有修改信息
      if (!info || !info.changes || info.changes.length === 0) {
        return false;
      }

      // 检查每一个修改，看是否涉及标题行
      for (const change of info.changes) {
        // change.from 和 change.to 是 {line, ch} 对象
        const startLine = change.from.line;
        const endLine = change.to.line;

        // 检查修改影响的行范围内是否有标题行
        for (let line = startLine; line <= endLine; line++) {
          const lineContent = editor.getLine(line);
          // 检查该行是否以 # 开头（标题行）
          if (lineContent && /^#{1,8}\s/.test(lineContent)) {
            return true;
          }
        }
      }

      return false;
    } catch (e) {
      console.error('检查标题行时出错:', e);
      return false;
    }
  }

  onunload() {
    if (this.autoGenerateTimeout) {
      clearTimeout(this.autoGenerateTimeout);
    }
    console.log('Heading Numberer 插件已卸载');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    // 在保存前记录当前持久化的配置（作为 "上一次配置"），便于之后移除标题时兼容旧配置
    try {
      const existing = await this.loadData();
      this.previousSettings = Object.assign({}, DEFAULT_SETTINGS, existing || {});
    } catch (e) {
      this.previousSettings = Object.assign({}, DEFAULT_SETTINGS);
    }
    await this.saveData(this.settings);
  }

  // 生成标题序号
  generateHeadingNumbers(editor, preserveCursor = true) {
    // 保存光标位置（如果需要保持光标）
    const cursorPos = preserveCursor ? editor.getCursor() : null;
    const scrollInfo = preserveCursor ? editor.getScrollInfo ? editor.getScrollInfo() : null : null;

    const content = editor.getValue();
    const lines = content.split('\n');
    const counters = new Array(9).fill(0); // 支持最多 8 级标题，下标 0-8
    const newLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,8})\s+(.*)$/);

      if (match) {
        const hashes = match[1];
        const level = hashes.length;
        let title = match[2];

        // 根据设置决定是否移除已有的序号
        const cleanedTitle = this.settings.removeExisting ? this.stripNumberPrefixes(title) : title;

        // 检查是否应该生成序号
        if (level >= this.settings.startLevel && level < this.settings.startLevel + this.settings.depth) {
          // 重置更深层级的计数器（支持到 8 级）
          for (let j = level + 1; j <= 8; j++) {
            counters[j] = 0;
          }

          // 增加当前级别的计数器
          counters[level]++;

          // 生成序号
          const numbering = this.generateNumbering(level, counters);
          const newTitle = numbering + ' ' + cleanedTitle;
          const newLine = hashes + ' ' + newTitle;
          newLines.push(newLine);
        } else {
          // 对于不在范围内的标题，仅移除序号
          newLines.push(hashes + ' ' + cleanedTitle);
        }
      } else {
        newLines.push(line);
      }
    }

    editor.setValue(newLines.join('\n'));

    // 恢复光标位置（如果需要）
    if (preserveCursor && cursorPos) {
      editor.setCursor(cursorPos);
      if (scrollInfo && editor.scrollIntoView) {
        editor.scrollIntoView(cursorPos);
      }
    }
  }

  // 命令使用的移除函数（调用统一的 stripNumberPrefixes）
  removeHeadingNumbers(editor) {
    const content = editor.getValue();
    const cleaned = this.stripNumberPrefixes(content);
    editor.setValue(cleaned);
  }

  // 生成序号字符串
  generateNumbering(level, counters, tempConfigs) {
    let numbering = '';
    const endLevel = Math.min(level, this.settings.startLevel + this.settings.depth - 1);

    // 决定编号起始段：
    // 如果 prependParentNumber 为 false 且当前处理的标题级别大于起始级别，则跳过首级（startLevel）段
    let firstSegment = this.settings.startLevel;
    if (!this.settings.prependParentNumber && level > this.settings.startLevel) {
      firstSegment = this.settings.startLevel + 1;
    }

    for (let currentLevel = firstSegment; currentLevel <= endLevel; currentLevel++) {
      const configIndex = currentLevel - this.settings.startLevel;
      const config = (tempConfigs && tempConfigs[configIndex]) || this.settings.levelConfigs[configIndex] || { style: '1', separator: '.' };
      const counter = counters[currentLevel] || 0;

      const formattedNumber = this.formatNumber(counter, config.style);
      const displayFormat = config.displayFormat || '{}';
      numbering += this.applyDisplayFormat(formattedNumber, displayFormat);

      if (currentLevel < endLevel) {
        numbering += config.separator;
      }
    }

    return numbering;
  }

  // 格式化数字
  formatNumber(num, style) {
    if (num <= 0) return '';

    switch (style) {
      case '1':
        return String(num);
      case 'a':
        return this.toLetters(num, false); // false 表示小写字母
      case 'A':
        return this.toLetters(num, true);  // true 表示大写字母
      case 'i':
        return this.toRoman(num).toLowerCase();
      case 'I':
        return this.toRoman(num);
      case '一':
        return this.toChineseUpper(num);
      case '①':
        return this.toCircledNumber(num);
      default:
        return String(num);
    }
  }

  // 将数字转换为字母序列（a, b, ..., z, aa, ab, ..., az, ba, ...)
  // 最大支持到 zzz (26 + 26^2 + 26^3 = 18278)
  toLetters(num, isUpperCase = false) {
    if (num <= 0) return '';
    if (num > 18278) return String(num); // 超过 zzz 的上限则返回数字

    const base = isUpperCase ? 'A'.charCodeAt(0) : 'a'.charCodeAt(0);
    let result = '';
    let n = num;

    // 26进制递推
    // 将数字转换为26进制：1-26 对应 a-z, 27-702 对应 aa-zz, 703-18278 对应 aaa-zzz
    while (n > 0) {
      n--; // 转为 0-25 范围
      result = String.fromCharCode(base + (n % 26)) + result;
      n = Math.floor(n / 26);
    }

    return result;
  }

  // 应用显示格式（displayFormat）到数字
  applyDisplayFormat(number, displayFormat) {
    if (!displayFormat || displayFormat === '{}') {
      return number;
    }
    return displayFormat.replace('{}', number);
  }

  // 转换为中文大写数字（支持 0-999）
  toChineseUpper(num) {
    if (num <= 0 || num > 999) {
      return String(num);
    }

    const chineseNumbers = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];

    if (num < 10) {
      return chineseNumbers[num];
    }

    let result = '';
    const digits = String(num).split('').map(Number);

    for (let i = 0; i < digits.length; i++) {
      const digit = digits[i];
      const unitIndex = digits.length - 1 - i;

      if (digit === 0) {
        if (result && !result.endsWith('零')) {
          result += '零';
        }
      } else {
        result += chineseNumbers[digit];
        if (unitIndex > 0) result += units[unitIndex];
      }
    }

    // 处理末尾和连续的零
    return result.replace(/零+$/, '').replace(/零+/g, '零');
  }

  // 转换为带圈阿拉伯数字（支持 1-50）
  toCircledNumber(num) {
    if (num > 0 && num <= 20) {
      const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
        '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
      return circledNumbers[num - 1];
    } else if (num > 20 && num <= 50) {
      // 对于 21-50，使用双圈数字
      const doubleCircledNumbers = ['㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
        '㉛', '㉜', '㉝', '㉞', '㉟', '㊱', '㊲', '㊳', '㊴', '㊵',
        '㊶', '㊷', '㊸', '㊹', '㊺', '㊻', '㊼', '㊽', '㊾', '㊿',
        '㊱', '㊲', '㊳', '㊴', '㊵', '㊶', '㊷', '㊸', '㊹', '㊺',
        '㊻', '㊼', '㊽', '㊾', '㊿'];
      return doubleCircledNumbers[num - 21];
    }
    return String(num);
  }

  // 转换为罗马数字
  toRoman(num) {
    const romanMatrix = [
      { value: 1000, numeral: 'M' },
      { value: 900, numeral: 'CM' },
      { value: 500, numeral: 'D' },
      { value: 400, numeral: 'CD' },
      { value: 100, numeral: 'C' },
      { value: 90, numeral: 'XC' },
      { value: 50, numeral: 'L' },
      { value: 40, numeral: 'XL' },
      { value: 10, numeral: 'X' },
      { value: 9, numeral: 'IX' },
      { value: 5, numeral: 'V' },
      { value: 4, numeral: 'IV' },
      { value: 1, numeral: 'I' }
    ];

    let roman = '';
    for (let i = 0; i < romanMatrix.length; i++) {
      while (num >= romanMatrix[i].value) {
        roman += romanMatrix[i].numeral;
        num -= romanMatrix[i].value;
      }
    }
    return roman;
  }

  // （已合并）旧的 removeNumberPrefix 已移除，使用 stripNumberPrefixes 统一处理

  // 统一移除标题序号（支持单行或全文输入）
  stripNumberPrefixes(input) {
    const isText = typeof input === 'string';
    if (!isText) return input;

    const processLine = (line) => {
      const match = line.match(/^(#{1,8})\s+(.*)$/);
      if (!match) return line;
      const hashes = match[1];
      let title = match[2];

      const maxLevels = Math.min(this.settings.depth, this.settings.levelConfigs.length);
      const tokenPattern = ['\\d+', '[a-zA-Z]+', '[ivxlcdmIVXLCDM]+', '[零一二三四五六七八九十百千]+', '[\\u2460-\\u24FF\\u3200-\\u32FF\\u3300-\\u33FF]+'].join('|');

      const segPatterns = [];
      for (let i = 0; i < maxLevels; i++) {
        const cfg = this.settings.levelConfigs[i] || { displayFormat: '{}', separator: '' };
        segPatterns.push(this._buildSegmentPattern(cfg, tokenPattern));
      }

      if (segPatterns.length) {
        const fullPattern = `^(?:${segPatterns.join('')})+\\s*`;
        try {
          title = title.replace(new RegExp(fullPattern), '').trim();
        } catch (e) {
          title = title.replace(/^[\d\w\(\)\[\]一二三四五六七八九十百零]+[\.\)\s\-、,，:：]*/g, '').trim();
        }

        // 最终通用回退
        const simplePrefixRe = /^[\s]*(?:[\(\[（【]?([\u2460-\u24FF\u3200-\u32FF\u3300-\u33FF\dA-Za-z零一二三四五六七八九十百千]+)[\)\]\)）】]?)[\.\)\s\-、,，:：]*/;
        let prev;
        do {
          prev = title;
          title = title.replace(simplePrefixRe, '').trim();
        } while (title !== prev);
      }

      return hashes + ' ' + title;
    };

    if (input.indexOf('\n') >= 0) {
      return input.split('\n').map(processLine).join('\n');
    } else {
      return processLine('# ' + input).replace(/^#\s+/, '');
    }
  }

  // 辅助方法：构建单个段的正则模式
  _buildSegmentPattern(cfg, tokenPattern) {
    const disp = cfg.displayFormat || '{}';
    const escaped = disp.replace(/[-/\\^$*+?.()|[\]{}]/g, (m) => {
      if (m === '{' || m === '}') return m;
      return '\\' + m;
    });
    const seg = escaped.replace(/\{\}/g, `(${tokenPattern})`);

    let sepPart = '';
    if (Object.prototype.hasOwnProperty.call(cfg, 'separator')) {
      if (cfg.separator === '') {
        sepPart = '';
      } else {
        const sepEsc = cfg.separator.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\\$&');
        sepPart = `(?:${sepEsc})?`;
      }
    } else {
      sepPart = '(?:[\\.)\\s\\-、,，:：])?';
    }
    return `(?:${seg})${sepPart}`;
  }
}

class HeadingNumbererSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '标题序号生成器设置' });

    // 起始级别设置
    new Setting(containerEl)
      .setName('起始标题级别')
      .setDesc('从第几级标题开始生成序号（1-8）')
      .addSlider(slider =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.startLevel)
          .onChange(async value => {
            // 在重建设置面板前保存当前页面上未保存的文本输入内容（displayFormat / separator）
            const savedInputs = {};
            containerEl.querySelectorAll('input[data-level][data-field]').forEach(inp => {
              savedInputs[`${inp.dataset.level}|${inp.dataset.field}`] = inp.value;
            });

            this.plugin.settings.startLevel = value;
            await this.plugin.saveSettings();
            // 重建面板（因 startLevel 变化需要改变 DOM）
            this.display();

            // 重建后恢复之前保存的输入值并触发 input 事件以更新预览
            containerEl.querySelectorAll('input[data-level][data-field]').forEach(inp => {
              const key = `${inp.dataset.level}|${inp.dataset.field}`;
              if (Object.prototype.hasOwnProperty.call(savedInputs, key)) {
                inp.value = savedInputs[key];
                inp.dispatchEvent(new Event('input', { bubbles: true }));
              }
            });
          })
      );

    // 生成深度设置
    new Setting(containerEl)
      .setName('生成深度')
      .setDesc('生成序号的层级数（1-8）')
      .addSlider(slider =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.depth)
          .onChange(async value => {
            this.plugin.settings.depth = value;
            // 确保 levelConfigs 有足够的项
            while (this.plugin.settings.levelConfigs.length < value) {
              this.plugin.settings.levelConfigs.push({ style: '1', displayFormat: '{}', separator: '' });
            }
            await this.plugin.saveSettings();
            this.display(); // 刷新显示
          })
      );

    // 为每一级标题添加配置
    containerEl.createEl('h3', { text: '每级标题的序号配置' });

    for (let i = 0; i < this.plugin.settings.depth; i++) {
      const levelNum = this.plugin.settings.startLevel + i;
      const config = this.plugin.settings.levelConfigs[i] || { style: '1', separator: '' };

      // 创建容器
      const levelContainer = containerEl.createDiv({ cls: 'heading-level-config' });
      levelContainer.createEl('h4', { text: `第 ${levelNum} 级标题配置` });

      // 创建预览容器（提前创建，便于在设置中引用）
      const preview = levelContainer.createDiv({ cls: 'heading-number-preview' });
      preview.dataset.level = String(levelNum);

      // 序号样式选择
      new Setting(levelContainer)
        .setName(`样式`)
        .setDesc('选择此级标题的序号样式')
        .addDropdown(dropdown => {
          dropdown
            .addOptions(STYLE_OPTIONS)
            .setValue(config.style)
            .onChange(async value => {
              this.plugin.settings.levelConfigs[i].style = value;
              await this.plugin.saveSettings();
              // 改变样式时刷新该级及所有后续级的预览（因为它们可能依赖当前级）
              this._refreshPreviewsFrom(containerEl, i);
            });
        });

      // 显示格式设置
      new Setting(levelContainer)
        .setName(`显示格式`)
        .setDesc('使用 {} 作为序号的占位符。例如：({}) 可生成 (1)、(2)、(3)；【{}】 可生成 【1】、【2】、【3】')
        .addText(text => {
          text
            .setPlaceholder('{}')
            .setValue(config.displayFormat || '{}')
            .onChange(async value => {
              this.plugin.settings.levelConfigs[i].displayFormat = value || '{}';
              await this.plugin.saveSettings();
              // 刷新该级及后续级预览
              this._refreshPreviewsFrom(containerEl, i);
            });

          // 实时预览（按键时）: 不保存，只用临时配置更新预览
          text.inputEl.dataset.level = String(levelNum);
          text.inputEl.dataset.field = 'displayFormat';
          text.inputEl.addEventListener('input', (e) => {
            const v = e.target.value || '{}';
            const tempCfg = Object.assign({}, config, { displayFormat: v });
            const overrides = {};
            overrides[i] = tempCfg;
            this.updatePreview(preview, levelNum, overrides);
          });
        });

      // 分隔符设置
      new Setting(levelContainer)
        .setName(`分隔符`)
        .setDesc('此级序号与下一级序号的分隔符')
        .addText(text => {
          text
            .setPlaceholder('(空)')
            .setValue(config.separator)
            .onChange(async value => {
              this.plugin.settings.levelConfigs[i].separator = value === undefined ? '' : value;
              await this.plugin.saveSettings();
              // 刷新该级及后续级预览
              this._refreshPreviewsFrom(containerEl, i);
            });

          // 实时预览（按键时）: 不保存，只用临时配置更新预览
          text.inputEl.dataset.level = String(levelNum);
          text.inputEl.dataset.field = 'separator';
          text.inputEl.addEventListener('input', (e) => {
            const v = e.target.value === undefined ? '' : e.target.value;
            const tempCfg = Object.assign({}, config, { separator: v });
            const overrides = {};
            overrides[i] = tempCfg;
            this.updatePreview(preview, levelNum, overrides);
          });
        });

      // 效果预览（已在上面提前创建）
      this.updatePreview(preview, levelNum);
    }

    // 移除已有序号选项
    containerEl.createEl('hr');
    // 是否在次级标题前添加首级序号
    new Setting(containerEl)
      .setName('在次级标题前添加首级序号')
      .setDesc('如果勾选，则在次级/更深级标题前加入首级的序号前缀。例如：首级为 “一、”，次级会显示为 “一、1”；未勾选则只显示次级自身的序号如 “1”')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.prependParentNumber)
          .onChange(async value => {
            this.plugin.settings.prependParentNumber = value;
            await this.plugin.saveSettings();
            // 仅刷新所有已渲染的预览，而不重建 DOM，避免改变焦点或破坏撤销栈
            const previews = containerEl.querySelectorAll('.heading-number-preview');
            previews.forEach(p => {
              const lvl = Number(p.dataset.level);
              if (!isNaN(lvl)) this.updatePreview(p, lvl);
            });
          })
      );
    new Setting(containerEl)
      .setName('自动移除已有序号')
      .setDesc('生成新序号时，自动移除标题中已有的序号')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.removeExisting)
          .onChange(async value => {
            this.plugin.settings.removeExisting = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('自动生成序号')
      .setDesc('当标题内容改变时，自动重新生成序号')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoGenerateOnChange)
          .onChange(async value => {
            this.plugin.settings.autoGenerateOnChange = value;
            await this.plugin.saveSettings();
          })
      );

    // 帮助信息
    containerEl.createEl('h3', { text: '使用说明' });
    const helpText = containerEl.createEl('div', { cls: 'heading-help-text' });
    helpText.createEl('p', { text: '1. 打开要处理的笔记文件' });
    helpText.createEl('p', { text: '2. 使用命令面板（Ctrl+P）输入"生成标题序号"来为标题添加序号' });
    helpText.createEl('p', { text: '3. 使用"移除标题序号"命令来移除序号' });

  }

  // 更新某一级的预览：展示从 startLevel 到该级的实际编号效果（用若干示例数字）
  updatePreview(container, level, tempConfigs) {
    container.innerHTML = '';
    const examples = [1, 2, 3];
    const parts = examples.map(num => {
      const counters = new Array(9).fill(0);
      const start = this.plugin.settings.startLevel;
      // 优化：所有层级都使用相同的示例数字，使预览更直观（例如 1.1、2.2、3.3）
      for (let l = start; l <= level; l++) {
        counters[l] = num;
      }
      return this.plugin.generateNumbering(level, counters, tempConfigs);
    });

    const text = parts.length ? `效果预览: ${parts.join('   ')}...` : '效果预览: -';
    container.createEl('small', { text });
  }

  // 辅助方法：从指定 configIndex 开始刷新所有后续级的预览（因为它们依赖该级配置）
  _refreshPreviewsFrom(containerEl, startIndex) {
    for (let i = startIndex; i < this.plugin.settings.depth; i++) {
      const levelNum = this.plugin.settings.startLevel + i;
      const preview = containerEl.querySelector(`[data-level="${levelNum}"]`);
      if (preview) {
        this.updatePreview(preview, levelNum);
      }
    }
  }
}

module.exports = HeadingNumbererPlugin;
