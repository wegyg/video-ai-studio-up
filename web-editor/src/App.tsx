import { basicSupport } from './support';
import { Editor } from './ui/Editor';
import { UnsupportedScreen } from './ui/UnsupportedScreen';

/** WebCodecs가 없거나 보안 컨텍스트가 아니면 안내 화면 (R1.3) */
export function App() {
  const { secureContext, webcodecs } = basicSupport();
  if (!secureContext || !webcodecs) return <UnsupportedScreen insecure={!secureContext} />;
  return <Editor />;
}
