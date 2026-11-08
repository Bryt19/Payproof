# PayProof - AI Development Instructions

## Project Overview
PayProof is a Solana-powered payment verification platform
for merchants and customers, with an initial focus on Africa.

## Technology Stack
- Next.js with App Router
- TypeScript
- Tailwind CSS
- Solana Devnet
- Phantom Wallet
- Solana Pay
- Supabase

## Development Rules
1. Build incrementally, one feature at a time.
2. Explain significant changes before implementing them.
3. Use TypeScript and avoid unnecessary dependencies.
4. Keep components reusable and maintainable.
5. Follow responsive design and accessibility practices.
6. Do not introduce unnecessary gradients or generic AI-looking UI.
7. Test changes before declaring a task complete.

## Blockchain Security
1. Never request or store users' wallet recovery phrases.
2. Never expose private keys or signing secrets.
3. Wallet signing must happen on the client.
4. Never trust frontend payment status.
5. Verify payment transactions against Solana independently.
6. Use Devnet during development.
7. Never claim a payment is confirmed without on-chain verification.

## Workflow
- Inspect existing code before modifying it.
- Avoid overwriting working features.
- Explain new dependencies before installing them.
- Keep changes focused.
- Report files changed and tests performed.