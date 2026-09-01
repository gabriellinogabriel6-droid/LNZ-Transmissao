# LNZ Transmissão

Site de salas públicas e privadas com transmissão de tela, chat, arquivos, call de voz e feedback.

## Recursos desta versão

- Salas públicas e privadas.
- O dono pode **fechar e abrir a sala a qualquer momento**.
  - Sala fechada: ninguém novo entra.
  - Quem já está dentro continua normalmente.
  - Sala pública fechada some da lista pública até ser reaberta.
- Compartilhamento de tela via WebRTC.
- **Áudio opcional da aba do navegador** na transmissão.
  - O transmissor não ouve o próprio player, evitando retorno.
  - O áudio geral do sistema é solicitado como excluído para reduzir captura do Discord/Windows.
  - Para transmitir áudio, prefira selecionar uma **aba do Chrome** e marcar o áudio da aba.
- **Call de voz** dentro da sala.
  - Entrar/sair da call.
  - Microfone ON/OFF.
  - Cancelamento de eco, redução de ruído e controle automático de ganho do navegador.
- Chat escrito em tempo real.
- Envio de arquivos de até 2 MB: imagens, PDF, TXT, ZIP, Word, Excel e PowerPoint.
- Executáveis e scripts perigosos são bloqueados no chat.
- Avatar com zoom e ajuste para cima, baixo, esquerda e direita.
- Arrastar a foto com mouse ou toque para ajustar o enquadramento.
- Imagem LNZ como fundo com animação suave de movimento/zoom.
- Botão do Discord oficial.
- Formulário de feedback com envio opcional para webhook do Discord pelo servidor.

## Rodar no PC

```bat
npm install
npm start
```

Depois abra:

```text
http://localhost:3000
```

## Configuração no Render

Em **Environment**, configure as variáveis desejadas:

```env
DISCORD_URL=https://discord.gg/m67kQeZrns
BRAND_NAME=LNZ Transmissão
FEEDBACK_WEBHOOK_URL=COLE_SEU_WEBHOOK_AQUI
```

**Não coloque o webhook no GitHub.** Deixe `FEEDBACK_WEBHOOK_URL` somente nas Environment Variables do Render.

Opcionalmente, para consultar os feedbacks guardados enquanto o servidor estiver ligado:

```env
FEEDBACK_ADMIN_TOKEN=ESCOLHA_UM_TOKEN_FORTE
```

A rota fica em `/admin/feedback?token=SEU_TOKEN`.

## TURN (recomendado para WebRTC)

Para melhorar a conexão de transmissão/call entre pessoas em redes diferentes:

```env
TURN_URL=turn:seu-servidor-turn:3478
TURN_USERNAME=usuario
TURN_CREDENTIAL=senha
```

Sem TURN, WebRTC funciona em muitas redes, mas pode falhar em alguns NATs/firewalls.

## Observação

As salas, mensagens e feedbacks ficam em memória. Quando o Render reinicia o serviço, esses dados temporários são apagados.


## Áudio na tela inteira

Esta versão tenta permitir áudio também em **Tela inteira**, além de janela/aba, quando o navegador e o sistema operacional oferecerem essa opção.

Importante:
- a janela de escolha do que compartilhar é do próprio **Chrome/Edge**, então o texto e os botões dela não podem ser personalizados pelo site;
- em alguns PCs o navegador libera áudio da **Tela inteira**; em outros, só de **Janela** ou **Guia/Aba**;
- se você ativar áudio na tela inteira, pode captar sons do sistema, inclusive Discord, jogo, música e notificações.

## Áudio + call (ajuste mais recente)

- O compartilhamento de tela inicia com envio de áudio habilitado. O navegador ainda mostra a opção de áudio disponível para a fonte escolhida.
- `suppressLocalAudioPlayback` fica desativado: ao transmitir áudio do sistema, o site não pede ao navegador para silenciar o som local do PC/Discord.
- O transmissor continua com o preview local mudo para não ouvir a própria transmissão dentro do site.
- Quem assiste controla individualmente o som da transmissão com ON/OFF e volume no painel **Mix**.
- O volume da **Call de voz** é separado do volume da **Transmissão**.
- Participantes na call aparecem como **Falando agora**, **Na call • Em silêncio** ou **Na call • Mic OFF**. O avatar ganha destaque enquanto a pessoa fala.


## Ajuste do feedback

- O botão **Enviar feedback** foi removido da lateral/rodapé da sala.
- Agora **Feedbacks** e **Enviar feedback** ficam no **menu principal / tela inicial**.


# Atualização: login obrigatório + várias transmissões

## Conta obrigatória

- Para usar as salas, a pessoa precisa **criar conta ou fazer login**.
- Cada login é único: duas pessoas **não conseguem cadastrar o mesmo nome de usuário**, inclusive mudando apenas maiúsculas/minúsculas.
- Senhas não são guardadas em texto; ficam protegidas com hash no servidor.
- A sessão fica salva em cookie seguro por até 30 dias.
- O nickname dentro das salas passa a ser o próprio login da conta.

## PostgreSQL no Render

Para as contas continuarem existindo após reiniciar ou atualizar o site, crie um banco **PostgreSQL** no Render e adicione ao Web Service a variável:

```env
DATABASE_URL=URL_INTERNA_DO_POSTGRES
```

O servidor cria automaticamente as tabelas `users`, `sessions` e `feedbacks`. Sem `DATABASE_URL`, existe um modo temporário em memória apenas para testes; ele apaga as contas quando o servidor reinicia.

## Atualização e queda do servidor

- O navegador verifica a versão do site automaticamente.
- Quando uma versão nova é publicada, aparece **Nova versão disponível** com botão **Atualizar agora**.
- Se o Render cair/reiniciar ou a conexão for perdida, aparece **Conexão perdida** e o mesmo botão para recarregar.

## Várias pessoas compartilhando tela

- A aplicação **não impõe um número fixo de transmissores por sala**.
- Vários participantes podem apertar **Compartilhar tela** ao mesmo tempo.
- Cada tela aparece em um card separado na grade de transmissões.
- Cada espectador pode ligar/desligar o som de cada transmissão e usar o Mix de volume.
- O limite real depende da internet, CPU/memória dos dispositivos, navegador e TURN/WebRTC; portanto não existe garantia prática de quantidade infinita.
