# Audio Switcher Linux (PipeWire) · OpenDeck

Plugin **nativo Linux** (Node.js + Stream Deck SDK) que alterna o **sink de áudio predefinido** do **PipeWire** entre duas saídas que escolheres. Usa **WirePlumber** (`wpctl`, `pw-dump`) — **sem Wine**, sem binários Windows.

![Ícone do plugin](audio-switcher.sdPlugin/imgs/icone.png)

*(Para listagem pública: adiciona uma captura real do OpenDeck em [`docs/STORE.md`](docs/STORE.md).)*

---

## Requisitos

| Requisito | Notas |
|-----------|--------|
| **OpenDeck** | Pacote **nativo** (`.deb` / `.rpm`) recomendado para `wpctl`/`pw-dump` no PATH. Em **Flatpak** o sandbox pode bloquear estes comandos. |
| **Node.js 20+** | O OpenDeck executa `bin/plugin.js` com o `node` do sistema. |
| **PipeWire / WirePlumber** | `wpctl` e idealmente `pw-dump` disponíveis no PATH. |
| **`zip`** | Só para `npm run build` (`sudo apt install zip` no Ubuntu). |

---

## Build do pacote de release

Na **raiz** do repositório:

```bash
cd audio-switcher.sdPlugin && npm install && cd ..
npm run build
```

Gera:

- `dist/audio-switcher-opendeck-linux-v<Version>.sdPlugin.zip`  
  (a `<Version>` vem de `audio-switcher.sdPlugin/manifest.json` → campo **`Version`**).

Só JavaScript (sem ZIP):

```bash
cd audio-switcher.sdPlugin && npm run build:js
```

### Validar o ZIP (estrutura OpenDeck)

O `npm run build` **já valida** automaticamente o arquivo gerado. Para rever um ZIP existente:

```bash
npm run verify
```

**Validação manual** (o que revistas de código costumam pedir):

```bash
cd dist
unzip -l audio-switcher-opendeck-linux-v1.2.0.sdPlugin.zip | head -20
```

Na listagem, a **primeira pasta** tem de ser **`audio-switcher.sdPlugin/`** — não `dist/...`, nem `audio-switcher.sdPlugin/audio-switcher.sdPlugin/`.

Depois de extrair:

```bash
unzip -q audio-switcher-opendeck-linux-v1.2.0.sdPlugin.zip -d /tmp/test-plugin
ls /tmp/test-plugin
# Tem de aparecer só: audio-switcher.sdPlugin
```

---

## Instalação no OpenDeck (passo a passo)

1. **Remove** versões antigas do mesmo plugin (mesmo UUID) em Definições → Plugins, se existirem.
2. **Instala** o ficheiro `dist/audio-switcher-opendeck-linux-v….sdPlugin.zip` pela opção de instalar plugin a partir de ficheiro (conforme a tua versão do OpenDeck).
3. **Reinicia** o OpenDeck (ou recarrega plugins).
4. Arrasta a ação **«Toggle audio output»** para um botão.
5. No painel de propriedades: escolhe **Saída primária** e **Saída secundária**, **Guardar** (ou espera o guardado automático ao mudar as listas).
6. Clica na tecla: o sink predefinido deve alternar e o **ícone** deve refletir o estado (dois estados no manifest).

**Cópia manual da pasta** (alternativa ao ZIP): extrai o ZIP e copia `audio-switcher.sdPlugin` para:

- Nativo: `~/.config/opendeck/plugins/`
- Flatpak: algo como `~/.var/app/…/config/opendeck/plugins/` (varia com o ID da app).

---

## Manifest (identidade no OpenDeck)

| Campo | Valor actual | Nota |
|--------|----------------|------|
| **UUID** do plugin | `com.maicondev.opendeck.pipewire-sink-toggle` | Não mudar após utilizadores instalarem — quebra perfis. |
| **UUID** da acção | `…pipewire-sink-toggle.toggle` | Idem. |
| **Name** / **Description** | Texto curto para lista e detalhe | Ajustáveis para marketing; UUID mantém-se. |

---

## Configuração rápida

- **Atualizar lista** — volta a pedir dispositivos ao PipeWire.
- **Guardar** — confirma definições (há também guardado automático ao alterar os `<select>`).
- Correspondência de nomes: **exacta** (ignorando maiúsculas) e, se preciso, **parcial** no nome do sink.

---

## Logs

Prefixo nos logs: `[pipewire-sink-toggle]`. Em Linux: `~/.local/share/opendeck/logs/` (ou equivalente da tua instalação).

---

## Checklist “pronto para distribuir”

- [ ] `manifest.json` com **Version** correcta para o release.
- [ ] `npm run build` sem erros e mensagem **`validação OK`**.
- [ ] `npm run verify` passa no ZIP que vais publicar.
- [ ] Teste **instalação limpa**: remover plugin antigo → instalar ZIP novo → tecla + troca de dispositivo + ícone.
- [ ] (Opcional) Captura ou GIF para README / loja — ver [`docs/STORE.md`](docs/STORE.md).

---

## Estrutura do repositório

- [`build.js`](build.js) — build + validação da estrutura do ZIP.
- [`audio-switcher.sdPlugin/manifest.json`](audio-switcher.sdPlugin/manifest.json) — metadados oficiais do plugin.
- [`audio-switcher.sdPlugin/src/`](audio-switcher.sdPlugin/src/) — código TypeScript.

## Licença

MIT (ver `audio-switcher.sdPlugin/package.json`).
