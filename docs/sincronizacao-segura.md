# Sincronização segura do APPCAR

A implementação atual é descrita em [Sincronização automática e reinicialização financeira](sincronizacao-automatica-reinicio.md).

O protocolo inicial publicado em 17/11/2026 comparava a base completa em transações e solicitava escolha para qualquer divergência. A evolução local utiliza atualizações em tempo real, combina mudanças independentes por ID, mantém conflitos reais e acrescenta geração/revisão para uma reinicialização segura. Nenhuma conta real foi reinicializada durante o desenvolvimento.

As regras locais foram ampliadas para proteger as gerações. Sua publicação, a atualização do GitHub/Vercel e a reinicialização de uma conta real dependem de autorizações posteriores. Não publicar apenas o app com as regras antigas.

Os comandos, o inventário dos armazenamentos, as condições de backup e confirmação, os 49 testes de sincronização, os nove testes de segurança e os 11 cenários Chrome/Edge estão no documento atual. O roteiro anterior de validação manual foi mantido como registro histórico.
