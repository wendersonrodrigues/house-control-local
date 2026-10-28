<p align="center">
  <img src="docs/icon.png" width="112" alt="Ícone do HomeOs Bar">
</p>

<h1 align="center">HomeOs Bar</h1>

<p align="center">
  A sua casa como uma maquete 3D ao vivo, na barra de menu do Mac e em volta do notch,<br>
  controlando luzes, ares-condicionados, portão, atalhos e automações pelo Home Assistant, direto na rede local.
</p>

<p align="center">
  <img src="docs/hero.png" alt="O painel, a tela de um ar-condicionado e a tela de uma luz">
</p>

O HomeOs Bar é um fork do [House Control](https://github.com/0xProbabillity/house-control), de
[0xProbability](https://github.com/0xProbabillity), adaptado a uma casa que roda tudo no Home Assistant.
A interface está em português do Brasil. A documentação original, em inglês, fica em
[docs/README-house-control.md](docs/README-house-control.md).

## O que ele faz

- **Fica na barra de menu.** Clique na casinha e o painel desce; clique fora e ele some.
- **A planta da casa em 3D.** Cômodos, paredes, portas, janelas e móveis vêm de um único arquivo JSON.
  As luzes iluminam a maquete como iluminam o cômodo, e um ar ligado sopra ar visível.
- **Luzes.** Toque para acender ou apagar. As que têm brilho, temperatura de branco ou cor ganham uma tela própria.
- **Ares-condicionados.** Liga/desliga, temperatura, modo, ventilação e direção do ar, com a temperatura do ambiente.
  Os modos do Midea (Silent, low, medium, high, Full, auto) aparecem como Silencioso, Baixo, Médio, Alto, Máximo e Automático.
- **Portão.** Mostra se está aberto, fechado, abrindo ou fechando. Abre e fecha com **dois toques**: o primeiro arma
  o botão e o segundo, em até 3,5 segundos, confirma. Um clique perdido na barra de menu nunca abre a casa.
- **Atalhos.** Scripts e cenas do Home Assistant num toque ("Apagar todas", "Luzes externas"…), no painel e na ilha.
- **Chaves de automação.** Liga e desliga `input_boolean` e automações que você escolher, como "Luzes por presença".
- **Ilha no notch.** Pare o ponteiro sobre o notch do MacBook e uma mini maquete da casa desce dele, com portão,
  atalhos e todos os dispositivos a um clique.
- **Widgets.** A casa em 3D na mesa do Mac, cenas, luzes e ares, e controles na Central de Controle.
- **Em casa ou fora.** Usa o endereço local do Home Assistant e, se ele não responder, passa sozinho para o externo.
  Quando o local volta a responder, ele volta para o local.
- **Funciona sem nada conectado.** Até você conectar o Home Assistant, tudo é simulado.

Por dentro, é um app nativo pequeno em Swift (AppKit) em volta de uma interface web em [Three.js](https://threejs.org).
Não tem Electron, servidor nem conta própria.

## O que muda em relação ao House Control

| | House Control | HomeOs Bar |
| --- | --- | --- |
| Plataformas | Smart Life/Tuya, Home Assistant, Philips Hue, Apple Home | **Só Home Assistant** (Tuya Local, Midea etc. chegam por ele) |
| Dispositivos | Luzes, tomadas, ares, sensores de temperatura | Os mesmos, mais **portão** (`cover`), **atalhos** (`script`, `scene`) e **chaves** (`input_boolean`, `automation`) |
| Conexão | Um endereço | **Endereço local com reserva externa** |
| Ar Midea | "Silent" e "low" juntos; "Full" não reconhecido; oscilação enviada como `on` | Seis velocidades e oscilação `both`/`horizontal`/`vertical` |
| iPhone e pareamento | Sim | Fora (o código continua no repositório) |
| AI Access (túnel Cloudflare) | Sim | Escondido |
| Idioma | Inglês | Português do Brasil |

Smart Life, Hue, Apple Home, AI Access e o pareamento com o celular **continuam no código**, só não aparecem.
Assim as novidades do projeto original continuam entrando sem conflito. Para trazer algum de volta, mude
[`core/Sources/HouseCore/Edition.swift`](core/Sources/HouseCore/Edition.swift) (e `EDITION` em
[`web/src/config.js`](web/src/config.js), para o navegador).

## Requisitos

| | |
| --- | --- |
| macOS | 13 Ventura ou mais novo |
| Xcode ou Command Line Tools | Swift 5.9 ou mais novo |
| Node.js | 20.19+ ou 22.12+ |
| Widgets | Xcode e [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) |
| HA simulado (opcional) | [uv](https://github.com/astral-sh/uv) (`brew install uv`) |

## Compilar e rodar

```bash
git clone https://github.com/wendersonrodrigues/house-control-local.git
cd house-control-local
./scripts/build-app.sh
open "build/HomeOs Bar.app"
```

O script compila a interface web (Vite), o app nativo (SwiftPM) e os widgets (XcodeGen + xcodebuild), e monta
`build/HomeOs Bar.app` com assinatura local (ad hoc). Sem Xcode, `SKIP_WIDGETS=1 ./scripts/build-app.sh` deixa os
widgets de fora.

Para instalar de vez, arraste `build/HomeOs Bar.app` para **Aplicativos**. Para abrir junto com o Mac, ligue
**Abrir ao iniciar sessão** nos **Ajustes** (⌘, ou clique com o botão direito na casinha → **Ajustes…**).

Com a assinatura ad hoc, o macOS pode pedir de novo a permissão de rede local depois de cada compilação. Para isso não
acontecer, assine com o seu certificado: `CODESIGN_IDENTITY="Apple Development: voce@exemplo.com (ABCDE12345)" ./scripts/build-app.sh`.

## Conectar o Home Assistant

1. No Home Assistant, abra seu perfil (seu nome no canto inferior esquerdo) → **Segurança** →
   **Tokens de acesso de longa duração** → **Criar token**. Dê o nome "HomeOs Bar" e copie.
2. No HomeOs Bar: botão direito na casinha → **Editar casa… → Conexões → Home Assistant**.
3. Preencha:
   - **Endereço local**, por exemplo `http://192.168.0.11:8123` (servidores na rede aparecem sozinhos: clique em **Usar**);
   - **Endereço externo** (opcional), por exemplo `https://homeassistant.seudominio.net`;
   - **Token de acesso**.
4. Clique em **Conectar**. Basta um dos dois endereços responder.

O token fica só neste Mac, em `~/Library/Application Support/HouseControl/homeassistant.json`, legível só pelo seu
usuário (modo `600`). Ele nunca vai para o repositório. **Desconectar** apaga o arquivo.

### O que aparece

| Home Assistant | No HomeOs Bar |
| --- | --- |
| `light.*` | Uma luz: liga/desliga e, se ela tiver, brilho, temperatura de branco e cor |
| `switch.*` | Uma luz numa tomada: liga/desliga |
| `climate.*` | Um ar-condicionado: modos, temperatura, ventilação, direção do ar, `eco` e `sleep` |
| `sensor.*` de temperatura | O termômetro do cômodo de um ar |
| `cover.*` | Um portão: abrir e fechar com confirmação, e o estado em movimento |
| `script.*`, `scene.*` | Um atalho: roda com um toque |
| `input_boolean.*`, `automation.*` | Uma chave de automação: liga e desliga |

As áreas do Home Assistant aparecem ao lado de cada entidade. O app assina os eventos do Home Assistant pelo
WebSocket, então uma luz acionada no interruptor ou por uma automação aparece no painel em menos de um segundo.

## Montar a sua casa

Botão direito na casinha → **Editar casa…**

<p align="center">
  <img src="docs/editor.png" width="820" alt="O editor de plantas">
</p>

- Arraste os cômodos para mover e o canto para redimensionar. Tudo encaixa a cada 5 cm.
- Onde dois cômodos se encostam, a parede entre eles aparece sozinha.
- Adicione portas, janelas, móveis, luzes e ares pela lista à esquerda.
- Em **Portões**, **Atalhos** e **Chaves de automação**, adicione o item e escolha a entidade em **Dispositivo real**.
  Esses itens não aparecem na planta: ficam no painel e na ilha.
- Escolha um item e selecione a entidade em **Dispositivo real**. Uma luz já assume o que a entidade sabe fazer, e
  um ar assume a faixa de temperatura.
- **Salvar e aplicar** grava a planta e recarrega o painel.

O app já vem com **Casa (planta provisória)**: os sete cômodos e todas as entidades desta casa já vinculadas, com
os tamanhos dos cômodos aproximados. Ela fica em [`web/public/plans/homeos.json`](web/public/plans/homeos.json).
A planta salva pelo editor vai para `~/Library/Application Support/HouseControl/plan.json`. Todos os campos estão
em [docs/floor-plan.md](docs/floor-plan.md) (em inglês).

## Como usar

| Faça isto | Para |
| --- | --- |
| Clique na casinha da barra de menu | Abrir ou fechar o painel |
| Clique com o botão direito na casinha | Ajustes, Editar casa, Carregar planta, Mostrar arquivo da planta, Mostrar registro dos dispositivos, Mostrar a Ilha, Abrir ao iniciar sessão, Recarregar, Sair |
| `⌘,` | Ajustes |
| Clique numa luz na maquete ou no botão dela | Acender ou apagar |
| Arraste para o lado sobre o botão de uma luz com brilho | Ajustar o brilho |
| Clique num ar ou no botão dele | Abrir a tela do ar: temperatura, modo, ventilação, direção |
| Clique em **Abrir**/**Fechar** do portão, e de novo | Abrir ou fechar o portão |
| Clique num atalho | Rodar o script |
| Clique numa chave | Ligar ou desligar a automação |
| Clique num cômodo | Aproximar e listar só os dispositivos dele |
| Arraste a maquete / role sobre ela | Girar / aproximar |
| `Esc` | Voltar e depois fechar |

## Testar sem a casa: o HA simulado

[`tools/lab`](tools/lab/README.md) roda um Home Assistant de verdade, cheio de dispositivos de demonstração, no
próprio Mac. Ele também cria **as entidades desta casa com os mesmos IDs** (luzes, `cover.portao_garagem`, os
quatro scripts, os `input_boolean` e a automação das câmeras), para testar tudo antes de apontar para a casa real.

```bash
./tools/lab/homeassistant.sh
```

A primeira vez instala o Home Assistant em `tools/lab/.ha` (cerca de 1 GB). O script mostra o endereço e um token de
teste. Para rodar o app numa pasta descartável, sem mexer na sua planta nem na sua conexão:

```bash
HOUSE_DATA_DIR=/tmp/homeos-lab HOUSE_OPEN_EDITOR=homeassistant "build/HomeOs Bar.app/Contents/MacOS/HouseControl"
```

## Desenvolvimento

```
web/      a interface: maquete Three.js, painel, ilha e editor (Vite, módulos ES simples)
core/     o pacote compartilhado: planta, plataformas de dispositivos, Home Assistant, testes (SwiftPM)
macos/    o app do Mac: item da barra de menu, painel, ilha, editor e Ajustes (SwiftPM)
widgets/  os widgets e controles do macOS (XcodeGen)
scripts/  build-app.sh monta o app
tools/lab Home Assistant simulado para testes
docs/     referência da planta e guias (em inglês)
```

Testes do pacote compartilhado:

```bash
cd core && swift test
```

Os testes ao vivo rodam contra o HA simulado: com endereço local fora do ar, o app passa para o externo, abre e
fecha o portão, roda os scripts e liga e desliga as chaves.

```bash
cd core
HOUSE_TEST_HA_URL=http://127.0.0.1:8123 HOUSE_TEST_HA_TOKEN=$(cat ../tools/lab/.ha/token) swift test --filter testLive
```

Para mexer na interface no navegador, com recarga automática (no navegador tudo é simulado):

```bash
cd web
npm install
npm run dev
```

Depois abra `http://localhost:5199/`. Acrescente `?mode=editor` para o editor, `?mode=island` para a ilha ou
`?plan=home` para a planta de demonstração.

Variáveis de ambiente úteis do app:

| Variável | Efeito |
| --- | --- |
| `HOUSE_DATA_DIR=/alguma/pasta` | Guarda planta, conexão e registro ali, em vez de Application Support |
| `HOUSE_DEV_URL=http://localhost:5199/` | Carrega a interface do servidor de desenvolvimento |
| `HOUSE_OPEN_ON_LAUNCH=1` | Abre o painel ao iniciar |
| `HOUSE_OPEN_EDITOR=1` | Abre o editor ao iniciar (`connections` ou `homeassistant` abre direto nessa tela) |
| `HOUSE_PIN=1` | Mantém o painel aberto quando perde o foco |
| `HOUSE_ISLAND=0` | Roda sem a ilha |
| `HOUSE_SNAPSHOT_DIR=/alguma/pasta` | Grava `panel.png`, `island.png` e `settings.png` ali alguns segundos depois de abrir |

## Privacidade

O HomeOs Bar só conversa com o seu Home Assistant. Não tem telemetria nem servidor próprio. Tudo o que é pessoal
fica em `~/Library/Application Support/HouseControl/` no seu Mac:

| Arquivo | Conteúdo |
| --- | --- |
| `plan.json` | A sua planta, com os IDs das entidades vinculadas |
| `settings.json` | Qual planta está ativa |
| `homeassistant.json` | Endereços e token do Home Assistant. Modo `600` |
| `events.log` | Os comandos enviados e as respostas. Sem tokens |

Nenhum desses arquivos faz parte do repositório.

## Limitações

- Os cômodos são retângulos alinhados aos eixos. Um cômodo em L vira dois cômodos.
- Câmeras ficam de fora (esta casa usa outra ferramenta para elas).
- Os widgets ainda não mostram portão, atalhos nem chaves de automação (o painel e a ilha mostram).

## Créditos

Baseado no [House Control](https://github.com/0xProbabillity/house-control), de 0xProbability, sob a licença MIT.
A maquete usa [Three.js](https://threejs.org) e os ícones são do [Lucide](https://lucide.dev).

Este projeto não tem ligação com o Home Assistant, a Tuya ou a Midea, nem é endossado por eles.

## Licença

[MIT](LICENSE)
