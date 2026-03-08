import VoiceWorkspace from '../components/VoiceWorkspace';
import FirstRunWalkthrough from '../demo/first-run/FirstRunWalkthrough';
import '../styles/vriksha.css';
import '../styles/editor.css';
import '../styles/voice-workspace.css';

export default function Home() {
  return (
    <>
      <VoiceWorkspace />
      <FirstRunWalkthrough />
    </>
  );
}
