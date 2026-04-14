# PipeWire Sink Toggle (OpenDeck)

Plugin no formato **Stream Deck / OpenDeck** (pasta `.sdPlugin`) que alterna o **sink de áudio predefinido** entre dois dispositivos, usando apenas **`wpctl`** (PipeWire / WirePlumber) em **Linux**.

## Requisitos

- **OpenDeck** (recomendado: pacote nativo `.deb`/`.rpm` se precisar de acesso fiável ao PipeWire do sistema; em Flatpak o `wpctl` pode estar limitado pelo sandbox).
- **Node.js 20+** instalado no sistema (o OpenDeck executa o plugin com o `node` do host).
- **`wpctl`** disponível no `PATH` (normalmente via **WirePlumber**).

## Instalação

1. Na pasta do plugin, instale dependências e faça o build (inclui o pacote para o OpenDeck):

   ```bash
   cd com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin
   npm install
   npm run build
   ```

   Isto gera `bin/plugin.js` e, na **raiz deste repositório**, o ficheiro **`pipewire-sink-toggle.streamDeckPlugin`** (ZIP com a pasta `.sdPlugin` por dentro, sem `node_modules`). É preciso ter o comando **`zip`** no sistema (`sudo apt install zip` no Ubuntu).

   Só para recompilar o JavaScript sem recriar o arquivo: `npm run build:js`.

2. Instale no OpenDeck de uma destas formas:

   **A) Pelo OpenDeck (ficheiro local / ZIP)**  
   Em versões recentes do OpenDeck existe a opção de **instalar plugin a partir de um ficheiro local** (menu de plugins / loja — algo como “instalar de ficheiro” ou “sideload”). Use o ficheiro **`pipewire-sink-toggle.streamDeckPlugin`** gerado no passo anterior (é o mesmo formato que um ZIP Elgato).

   **B) Copiar a pasta manualmente**  
   Copie a pasta completa **`com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin`** para:

   - Nativo: `~/.config/opendeck/plugins/`
   - Flatpak: `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/` (o prefixo pode variar com a id da app).

3. **Reinicie o OpenDeck** (ou recarregue os plugins, se a sua versão tiver essa opção).

## Configuração

1. Arraste a ação **«Toggle Audio Devices»** para um botão.
2. No painel de propriedades, escolha **Saída primária** e **Saída secundária** nas listas (preenchidas a partir do PipeWire). O sink predefinido aparece marcado como **· predefinido**. **Atualizar lista** volta a pedir os dispositivos; **Guardar** confirma. A alteração das listas também grava automaticamente após um breve atraso.
3. O plugin guarda o **nome completo** do sink; na tecla, a resolução faz correspondência **exacta** (ignorando maiúsculas) e, se necessário, **parcial** — perfis antigos com fragmentos de texto continuam a funcionar.

## Logs

O plugin escreve para **stdout** (mensagens com o prefixo `[pipewire-sink-toggle]`). O OpenDeck costuma guardar logs do processo; em Linux também pode haver ficheiros em `~/.local/share/opendeck/logs/`.

## Estrutura

- [`com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/manifest.json`](com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/manifest.json) — metadados, Node 20, só Linux, dois estados, Property Inspector.
- [`com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/src/`](com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/src/) — código TypeScript (`wpctl`, ação).
- [`com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/propertyInspector/`](com.maicondev.opendeck.pipewire-sink-toggle.sdPlugin/propertyInspector/) — UI das definições.

## Licença

MIT (veja o `package.json` do plugin).
