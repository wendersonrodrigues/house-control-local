# HomeOs no iPad (e no iPhone), sem App Store

O app nativo (`ios/`, edição `ios/project-homeos.yml`) roda no iPad deitado com o mesmo layout
da edição do HA: maquete à esquerda, painel à direita. Ele fala direto com o Home Assistant:
primeiro o endereço local (`http://192.168.0.11:8123`); quando esse não responde, passa sozinho
para o externo (`https://homeassistant.kacto.net`). O token fica no Keychain do aparelho.

A instalação é pelo Xcode, com a sua conta Apple pessoal (a gratuita serve).

## Uma vez só, no Mac

1. **Conta no Xcode.** Abra o Xcode → Settings → Accounts → **+** → Apple ID e entre com a sua
   conta. Aparece uma equipe "Seu Nome (Personal Team)".
2. **Id da equipe.** Ele aparece no próprio Xcode (Settings → Accounts → a equipe) e também no
   certificado criado na primeira instalação. Para ler no Terminal depois do passo 6:
   ```bash
   security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
   ```
   O id é o valor de `OU=` (10 letras e números).
3. **Arquivo local** `ios/Config/Local.xcconfig` (não vai para o git):
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   O bundle id é `net.kacto.homeosbar` (e `.Widgets`). Se o Xcode disser que já está em uso,
   acrescente ali uma linha `HOMEOS_BUNDLE_ID = net.kacto.homeosbar2`.

## Primeira instalação (com cabo)

4. Ligue o iPad ao Mac **pelo cabo**, desbloqueie e toque em **Confiar** neste computador.
5. **Modo de Desenvolvedor no iPad:** Ajustes → Privacidade e Segurança → **Modo de
   Desenvolvedor** → ligar → o iPad reinicia → confirme **Ativar**. (A opção só aparece depois que
   o iPad foi conectado a um Mac com Xcode; se não aparecer, faça o passo 6 uma vez e volte aqui.)
6. No Mac, na pasta do projeto:
   ```bash
   ./scripts/build-ios.sh --install
   ```
   Na primeira vez o Xcode registra o iPad na sua conta e cria o certificado. Se ele reclamar do
   aparelho, abra o Xcode → Window → Devices and Simulators uma vez, com o iPad ligado.
7. **Confiar no desenvolvedor, no iPad:** Ajustes → Geral → **VPN e Gerenciamento de
   Dispositivos** → "Apple Development: (seu e-mail)" → **Confiar**.
8. Abra o **HomeOs**. Ele pede acesso à rede local: **Permitir**. A tela do Home Assistant já vem
   com os dois endereços; falta só o token:
   no Home Assistant, perfil → Segurança → Tokens de acesso de longa duração → Criar token
   ("HomeOs iPad") → copie e cole no app → **Conectar**.

## A cada 7 dias (conta gratuita)

Com a conta gratuita a assinatura vale **7 dias**. Depois disso o app não abre até ser
reinstalado. Basta rodar de novo:
```bash
./scripts/build-ios.sh --install
```
O token, a planta e os ajustes continuam lá: reinstalar por cima não apaga nada.

Sem cabo: com o iPad ligado uma vez pelo cabo, marque **Connect via network** em Xcode → Window →
Devices and Simulators. Daí em diante o `--install` funciona com o Mac e o iPad na mesma rede Wi-Fi.

Limites da conta gratuita: até 3 apps seus instalados por aparelho e 10 bundle ids novos por
semana (o HomeOs usa 2: o app e os widgets). Com a conta paga (US$ 99/ano) a assinatura vale 1 ano.

## Mudou a casa no editor do Mac?

**Painel do HA (`/local/homeos/`, `/homeos-3d`):** no app do Mac, abra o menu do painel (ícone de
ajustes no topo) → **Enviar para o Home Assistant…** → Enviar. A planta em uso e a organização dos
cartões (ordem, tamanhos, etiquetas, o que está oculto) vão para o próprio HA, num painel escondido
"HomeOs (dados)" (`/homeos-dados`, não precisa abrir). O iPad pega na próxima vez que abrir o painel
ou recarregar. Onde ficam os cômodos, o mapa e o botão de energia continuam sendo de cada aparelho.
Precisa de um token de administrador no Mac (o de sempre serve).

**App nativo:** usa a planta que vai junto com o app (`web/public/plans/homeos.json`). Copie e reinstale:
```bash
./scripts/sync-plan.sh --ipad
```
Sem opções, o comando só copia e mostra o que mudou (luzes, cômodos, móveis…) e quais aparelhos
ficaram sem vínculo com o HA. A planta anterior fica em `build/homeos.antes.json`. `--ha` publica de
novo o app web no HA (necessário só quando o código muda).

## No dia a dia

- **Cômodos** ficam no menu inferior (dá para levar para cima no menu do painel). **Arraste os
  cartões para o lado** para ir ao cômodo seguinte (para a esquerda) ou ao anterior (para a direita).
- **Botão de energia** (no topo, à direita): dentro de um cômodo liga ou desliga só aquele
  cômodo; no início, a casa toda. Pede confirmação antes. Os dois em Organizar o painel →
  "Botão de energia".
- **Cômodos mesclados** no editor ("Mesclar com", por exemplo Corredor com Quintal) aparecem com um
  título só, "Quintal · Corredor", e os cartões lado a lado.
- **Editando os cartões**, tocar num cartão, atalho ou no botão de energia não aciona nada.
- **Tela inicial com organização própria** (Editar os cartões, ou Organizar o painel → "Cartões
  da tela inicial"): ordem, tamanho e lado dos cartões do início ficam separados dos cômodos. Na
  primeira vez, começa igual aos cômodos.
- **Tela inicial deitada e sem o mapa** (botão do mapa no topo): as seções ficam lado a lado e a
  tela rola para a direita (arraste para o lado; com mouse, arraste o espaço vazio ou use a roda).
  Cada seção tem até 6 colunas de cartões, ou 8 se tiver muitos aparelhos. Para mudar, use
  Editar os cartões → embaixo do título: "Largura" (4, 5, 6, 7, 8 ou 10) e "Posição" (Ao lado, ou Embaixo
  do cômodo anterior, para dois cômodos na altura). Um espaço livre separa os cômodos. Nesse modo a tela
  nunca rola para baixo: os cartões diminuem para tudo caber na altura. Ordem, tamanho e lado dos
  cartões nesse modo são próprios (na primeira vez, começam iguais à tela inicial com o mapa). Em pé ou com o mapa,
  volta a ser uma lista de cima para baixo.
- **Nome do cômodo na tela inicial** (com o mapa): toque para a maquete ir até aquele cômodo, sem
  sair da tela inicial; toque de novo para ver a casa toda.
- **Portão em quatro tamanhos** (Editar os cartões → toque no portão): Faixa (sem foto), Médio
  (foto ao lado do nome), Quadrado e Comprido (o quadrado esticado para o lado). Nos três com foto,
  a imagem do portão aberto aparece junto com a abertura.
- **Informação** (link abaixo dos cartões de um cômodo): para cada aparelho, o estado e desde quando
  (a hora vem do Home Assistant) e o período anterior, por exemplo "última vez acesa: por 25 min" ou
  quando o portão esteve aberto. Guarda só a última mudança de cada aparelho, neste aparelho.
- **Menu do painel** (ícone de ajustes no topo): editar e organizar os cartões, cômodos no menu
  inferior, **Modo leve**, Editar casa, Ajustes (conexão com o HA, planta).
- **Modo leve (aparelho antigo):** desenha a maquete em resolução 1× e sem o brilho das lâmpadas.
  Fica gravado no aparelho.
- Fora de casa, o painel de Ajustes mostra "pelo endereço externo". Ao voltar para o Wi-Fi de casa,
  o app volta sozinho para o endereço local.

## Para quem mexe no código

- Simulador: `./scripts/ios-sim.sh` (escolhe um iPad; `DEVICE=<nome ou id>` escolhe outro).
  `HOUSE_DATA_DIR=<pasta>` roda com dados descartáveis (o token vai para `<pasta>/homeassistant.json`
  em vez do Keychain), útil para testar contra o lab (`./tools/lab/homeassistant.sh`).
- O que muda no iPad vem do boot do app (`tablet: true`, `ios/Sources/HomeWeb.swift`) →
  `isTablet` em `web/src/bridge.js` → classe `html.tablet` em `web/src/style.css` (as mesmas
  regras da edição do HA).
