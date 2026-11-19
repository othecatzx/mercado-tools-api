'use strict';

// Mercado Livre normalmente retorna UTF-8. Alguns payloads legados chegam com
// bytes Windows-1252 inválidos em UTF-8; response.json() os troca por U+FFFD.
// Decodificar os bytes originais preserva os acentos, sem tentar adivinhar
// caracteres que já foram substituídos no banco.
function decodeMlMessageJson(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    source = new TextDecoder('windows-1252', { fatal: true }).decode(buffer);
  }
  return JSON.parse(source);
}

// Uma string com caractere de substituição perdeu informação e não pode ser
// corrigida com segurança sem consultar novamente o texto original.
function isBrokenEncoding(value) {
  return typeof value === 'string' && value.includes('\uFFFD');
}

function shouldRepairMessageText(stored, fresh) {
  return isBrokenEncoding(stored) && typeof fresh === 'string' &&
    fresh.trim().length > 0 && !isBrokenEncoding(fresh) && fresh !== stored;
}

module.exports = { decodeMlMessageJson, isBrokenEncoding, shouldRepairMessageText };
