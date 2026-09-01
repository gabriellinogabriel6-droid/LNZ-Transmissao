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

## Login persistente + recuperação de senha

Esta versão mantém o login obrigatório e adiciona recuperação de conta.

- O **nome de usuário é único** (`username_key` no PostgreSQL), então duas pessoas não podem usar o mesmo login, mesmo mudando maiúsculas/minúsculas.
- A senha é armazenada somente como **hash scrypt com salt**. A senha original nunca é gravada no banco.
- A sessão fica em cookie `HttpOnly` por até 30 dias.
- Ao criar uma conta, o site gera um **código de recuperação** no formato `LNZ-XXXX-XXXX-XXXX-XXXX-XXXX`.
- O código de recuperação também não é salvo em texto no banco: apenas o hash dele é armazenado.
- Em **Recuperar**, o usuário informa login + código de recuperação + nova senha.
- Depois de uma recuperação bem-sucedida, sessões antigas são encerradas e um **novo código de recuperação** é gerado.
- Usuários antigos, criados antes desta atualização, podem entrar normalmente e clicar em **Gerar novo código de recuperação** na conta.

### PostgreSQL obrigatório no Render

Para contas, senhas, perfis, amigos e códigos de recuperação continuarem existindo depois de reiniciar o serviço, configure `DATABASE_URL` no Render com seu PostgreSQL. A atualização cria automaticamente as novas colunas `recovery_code_hash` e `recovery_code_created_at`.

## Perfil, amigos e cor do site — corrigidos

Esta versão liga os três botões que antes apareciam sem funcionar:

- **Meu perfil:** abre o perfil da conta, mostra avatar/GIF, status, bio, data da conta e permite editar.
- **GIF no avatar:** PNG/JPG/WEBP/GIF com até aproximadamente 1,4 MB pelo navegador; o avatar e o enquadramento ficam salvos na conta.
- **Inspecionar perfil:** clique em uma pessoa na lista da sala ou em um amigo para abrir o perfil dela.
- **Amigos:** pesquisa usuários, envia pedido, aceita/recusa, cancela pedido e remove amizade. Pedidos recebidos aparecem com contador.
- **Cor do site:** presets + seletor personalizado. A cor fica salva no banco e é carregada quando a pessoa faz login.
- O tema altera botões, bordas, brilhos e outros detalhes principais para aquele usuário.

As amizades, bio, status, avatar e tema são persistidos no PostgreSQL quando `DATABASE_URL` está configurado no Render.

## Visual inspirado no Discord

A interface da sala agora usa uma organização mais parecida com apps sociais como o Discord, mantendo a identidade LNZ:

- barra lateral de atalhos;
- canais de transmissão, chat e call;
- lista de membros em painel próprio;
- chat com mensagens mais limpas, estilo canal;
- perfil, amigos e tema acessíveis pela lateral;
- cor personalizada do usuário continua sendo usada como destaque da interface.


## Painel Admin privado

Configure no Render:

```env
ADMIN_USERNAME=seu_login_exato
```

Depois entre no site com essa mesma conta. O botão **Painel Admin** aparecerá apenas para o administrador. A API também valida a sessão no servidor, então esconder o botão não é a proteção principal.

O painel mostra:
- contas cadastradas e último login;
- usuários online e sessões ativas;
- salas abertas agora;
- transmissões ativas;
- feedbacks, incluindo contato opcional;
- registros de criação/login/logout de conta, entrada/saída de sala, abertura/fechamento de sala, transmissão, call, chat e atualização/reinício do site.

Por privacidade e segurança, **senhas, códigos de recuperação e texto das mensagens do chat não são exibidos nos registros**.

## Call com câmera e controles por participante

Esta versão adiciona:

- **Câmera ON/OFF** para quem estiver na call.
- Grade de câmeras dentro da sala, com destaque em quem estiver falando.
- Indicadores de **Falando**, **Em silêncio**, **Mic OFF** e câmera ligada.
- Menu `⋯` em cada participante com:
  - Ver perfil.
  - Volume individual (0–100%).
  - Silenciar somente para você.
  - Ocultar/mostrar somente a câmera daquela pessoa para você.
- Para o dono da sala:
  - Silenciar/liberar o microfone de um participante na sala.
  - Remover participante da sala.
- O mute individual não afeta os outros participantes.
- A câmera local fica espelhada apenas no próprio preview.

### Observação sobre muitas câmeras

A call usa WebRTC ponto a ponto. Ela não possui um limite fixo imposto pelo código, mas quanto mais pessoas com câmera/microfone ao mesmo tempo, maior o uso de upload, download e CPU de cada participante. Para salas muito grandes, o ideal futuramente é usar uma arquitetura SFU dedicada.

## Contas salvas + Manter conectado

Esta versão reforça a persistência das contas e adiciona **Manter conectado**.

- Em produção/Render, criação e login de contas exigem PostgreSQL conectado por `DATABASE_URL`.
- Se o banco não estiver configurado, o site mostra um erro em vez de criar uma conta temporária que sumiria no próximo restart.
- Com **Manter conectado** marcado, a sessão fica persistente por até 90 dias neste dispositivo (ou até a pessoa clicar em Sair).
- Sem marcar, a autenticação usa cookie de sessão do navegador e sessão do servidor com validade menor.
- Senhas continuam armazenadas apenas como hash; o servidor não guarda a senha original.

### Render

Em **Environment**, configure `DATABASE_URL` com a URL do PostgreSQL. Depois salve e faça um novo deploy.


## Tudo salvo na conta

Com `DATABASE_URL` configurado no Render, esta versão mantém no PostgreSQL:

- login e senha protegida por hash;
- código de recuperação protegido;
- foto ou GIF do perfil (até 2 MB);
- zoom e posição X/Y da foto;
- bio e status;
- cor personalizada do site;
- amigos e pedidos de amizade;
- volume geral das transmissões;
- volume geral da call;
- preferência de mute da call/transmissão;
- preferência de enviar áudio ao compartilhar tela.

O navegador ainda usa cache/localStorage para abrir mais rápido, mas depois do login o **banco de dados é a fonte principal do perfil**. Assim o perfil volta em outro PC e depois de reinícios/deploys do Render.

> Importante: sem `DATABASE_URL`, o site bloqueia criação/login persistente para evitar contas que desapareçam após reiniciar o servidor.


## Limite de foto/GIF

- Foto e GIF de perfil: **até 10 MB**.
- O editor permite zoom, esquerda/direita e cima/baixo.
- Depois do enquadramento, clique em **Salvar foto/GIF**.
- Com o PostgreSQL conectado e a conta logada, o avatar e o enquadramento ficam salvos na conta.


## Usuário único sem aviso de banco

- A tela de login não mostra mais o aviso vermelho de `DATABASE_URL`.
- Na aba **Criar conta**, o nome é verificado enquanto a pessoa digita.
- Nomes são únicos sem diferenciar maiúsculas/minúsculas: `Linozera` e `linozera` contam como o mesmo usuário.
- Sem PostgreSQL, as contas funcionam na memória do servidor e podem ser perdidas quando o Render reiniciar. Para nomes e contas permanecerem reservados para sempre, ainda é necessário um banco persistente.


## Escolher outro nome

- Removida a mensagem de status do banco da tela de login.
- Adicionado botão **Escolher outro nome**.
- Se o nome já existir, o site avisa e pede outro nome.
- O botão limpa os campos e abre diretamente a criação de conta.


## Login simplificado

- Removidas as três abas grandes de Entrar / Criar conta / Recuperar.
- A tela abre direto no login.
- **Criar conta** e **Esqueci minha senha** ficam como atalhos simples abaixo do botão Entrar.
- Nas telas de cadastro/recuperação há um botão **Voltar para entrar**.
- Campo de senha com mostrar/ocultar.
- A criação de conta continua verificando usuário único.

## Interface simplificada

- Removidos da tela principal os atalhos **Amigos**, **Meu perfil** e **Cor do site**.
- Removidos também os mesmos atalhos da barra lateral da sala.
- O restante do site foi mantido.


## Temas visuais

- **Padrão LNZ**: visual roxo/preto original.
- **Halloween**: preto, roxo e laranja com animações sutis de morcegos e lua.
- A escolha fica salva no navegador.
- O tema respeita `prefers-reduced-motion` para reduzir animações quando o dispositivo solicitar.
