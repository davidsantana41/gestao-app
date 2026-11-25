import { notFound } from 'next/navigation';
import EntregaLocal from '@/components/gestao/EntregaLocal';

export const dynamic = 'force-dynamic';

export default function Demonstracao() {
  if (process.env.APPCAR_DEMO_LOCAL !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089') notFound();
  return <EntregaLocal />;
}
