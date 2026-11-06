export function maskCnj(value) {
  const digits = String(value).replace(/\D/g, '').slice(0, 20);
  const groups = [digits.slice(0, 7), digits.slice(7, 9), digits.slice(9, 13), digits.slice(13, 14), digits.slice(14, 16), digits.slice(16, 20)];
  return groups.reduce((text, group, index) => group ? text + (index ? index === 1 ? '-' : '.' : '') + group : text, '');
}

export function bindCnjMask(input) {
  input.addEventListener('input', () => {
    const before = input.value;
    const position = input.selectionStart ?? before.length;
    const count = before.slice(0, position).replace(/\D/g, '').length;
    const formatted = maskCnj(before);
    if (before === formatted) return;
    input.value = formatted;
    let cursor = 0, digits = 0;
    while (cursor < formatted.length && digits < count) {
      if (/\d/.test(formatted[cursor])) digits++;
      cursor++;
    }
    input.setSelectionRange(cursor, cursor);
  });
  // Deleting a separator should remove the adjacent digit rather than reinsert the separator.
  input.addEventListener('beforeinput', event => {
    const start = input.selectionStart, end = input.selectionEnd;
    if (start === null || start !== end || !['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) return;
    const backward = event.inputType === 'deleteContentBackward';
    const index = backward ? start - 1 : start;
    if (index < 0 || index >= input.value.length || /\d/.test(input.value[index])) return;
    event.preventDefault();
    const digitIndex = backward ? index - 1 : index + 1;
    if (digitIndex < 0 || digitIndex >= input.value.length) return;
    const next = input.value.slice(0, digitIndex) + input.value.slice(digitIndex + 1);
    const count = next.slice(0, backward ? digitIndex : start).replace(/\D/g, '').length;
    input.value = maskCnj(next);
    let cursor = 0, digits = 0;
    while (cursor < input.value.length && digits < count) { if (/\d/.test(input.value[cursor])) digits++; cursor++; }
    input.setSelectionRange(cursor, cursor);
  });
}
