This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Persistência e sincronização dos dados

O painel salva automaticamente uma cópia no navegador e sincroniza os dados com o Cloud Firestore usando autenticação anônima do Firebase. Cada instalação autenticada recebe um espaço de dados próprio.

Para ativar a sincronização na nuvem:

1. No Firebase Console, abra **Authentication → Sign-in method** e habilite **Anonymous**.
2. No Firebase Console, abra **Firestore Database → Rules** e publique o conteúdo do arquivo `firestore.rules` deste repositório.
3. Faça o deploy da aplicação novamente.

Se a nuvem estiver indisponível, o painel continua salvando no armazenamento local do navegador. Para que a sincronização funcione entre dispositivos, será necessário usar uma conta de login compartilhada; a autenticação anônima atual separa os dados por navegador/instalação.
