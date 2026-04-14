# PipeWire Sink Toggle (OpenDeck)

Plugin no formato **Stream Deck / OpenDeck** (pasta `.sdPlugin`) que alterna o **sink de áudio predefinido** entre dois dispositivos, usando apenas **`wpctl`** (PipeWire / WirePlumber) em **Linux**.

## Requisitos

- **OpenDeck** (recomendado: pacote nativo `.deb`/`.rpm` se precisar de acesso fiável ao PipeWire do sistema; em Flatpak o `wpctl` pode estar limitado pelo sandbox).
- **Node.js 20+** instalado no sistema (o OpenDeck executa o plugin com o `node` do host).
- **`wpctl`** disponível no `PATH` (normalmente via **WirePlumber**).

## Build e instalação

1. **Dependências do plugin** (uma vez, na pasta `audio-switcher.sdPlugin`):

   ```bash
   cd audio-switcher.sdPlugin
   npm install
   cd ..
   ```

2. **Pacote de release** (na **raiz** do repositório): lê a versão em `audio-switcher.sdPlugin/manifest.json`, compila o JS e gera um ZIP em `dist/`:

   ```bash
   npm run build
   ```

   Saída: `dist/audio-switcher-opendeck-linux-v<Version>.sdPlugin.zip` (por exemplo `dist/audio-switcher-opendeck-linux-v1.1.0.sdPlugin.zip`). O arquivo contém **`audio-switcher.sdPlugin/`** na raiz, só com ficheiros necessários em runtime (`manifest.json`, `bin/plugin.js`, `node_modules/ws`, `propertyInspector/`, `imgs/`).

   Requisitos: **`zip`** no PATH (`sudo apt install zip` no Ubuntu). Só para recompilar o JavaScript: `cd audio-switcher.sdPlugin && npm run build:js`.

3. Instale no OpenDeck de uma destas formas:

   **A) Pelo OpenDeck (ficheiro local / ZIP)**  
   Instale o ficheiro **`dist/audio-switcher-opendeck-linux-v….sdPlugin.zip`** (é um ZIP compatível com instalação de plugin OpenDeck / Stream Deck).

   **B) Copiar a pasta manualmente**  
   Copie a pasta completa **`audio-switcher.sdPlugin`** (a de desenvolvimento ou extraída do ZIP) para:

   - Nativo: `~/.config/opendeck/plugins/`
   - Flatpak: `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/` (o prefixo pode variar com a id da app).

4. **Reinicie o OpenDeck** (ou recarregue os plugins, se a sua versão tiver essa opção).

## Configuração

1. Arraste a ação **«Toggle Audio Devices»** para um botão.
2. No painel de propriedades, escolha **Saída primária** e **Saída secundária** nas listas (preenchidas a partir do PipeWire). O sink predefinido aparece marcado como **· predefinido**. **Atualizar lista** volta a pedir os dispositivos; **Guardar** confirma. A alteração das listas também grava automaticamente após um breve atraso.
3. O plugin guarda o **nome completo** do sink; na tecla, a resolução faz correspondência **exacta** (ignorando maiúsculas) e, se necessário, **parcial** — perfis antigos com fragmentos de texto continuam a funcionar.

## Logs

O plugin escreve para **stdout** (mensagens com o prefixo `[pipewire-sink-toggle]`). O OpenDeck costuma guardar logs do processo; em Linux também pode haver ficheiros em `~/.local/share/opendeck/logs/`.

## Estrutura

- [`build.js`](build.js) — empacota o release para `dist/*.sdPlugin.zip`.
- [`audio-switcher.sdPlugin/manifest.json`](audio-switcher.sdPlugin/manifest.json) — metadados, Node 20, só Linux, dois estados, Property Inspector.
- [`audio-switcher.sdPlugin/src/`](audio-switcher.sdPlugin/src/) — código TypeScript (PipeWire / `wpctl`, ação).
- [`audio-switcher.sdPlugin/propertyInspector/`](audio-switcher.sdPlugin/propertyInspector/) — UI das definições.

## Licença

MIT (veja o `package.json` do plugin).
