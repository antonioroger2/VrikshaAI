import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { loadLocalKeys } from '../lib/api-config';
import { useAgentStore } from '../store/agent-store';

export default function BYOKInline() {
  const [bedrockKey, setBedrockKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [qwenKey, setQwenKey] = useState('');
  const [googleTtsKey, setGoogleTtsKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const refreshAPIStatus = useAgentStore(s => s.refreshAPIStatus);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBedrockKey(localStorage.getItem('vriksha_bedrock_key') || '');
      const savedGroq = localStorage.getItem('vriksha_groq_key') || '';
      setGroqKey(savedGroq);
      setQwenKey(localStorage.getItem('vriksha_qwen_key') || '');
      setGoogleTtsKey(localStorage.getItem('vriksha_google_tts_key') || '');
      setGeminiKey(localStorage.getItem('vriksha_gemini_key') || '');
    }
  }, []);

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      if (bedrockKey) localStorage.setItem('vriksha_bedrock_key', bedrockKey);
      else localStorage.removeItem('vriksha_bedrock_key');

      if (groqKey) localStorage.setItem('vriksha_groq_key', groqKey);
      else localStorage.removeItem('vriksha_groq_key');

      if (qwenKey) localStorage.setItem('vriksha_qwen_key', qwenKey);
      else localStorage.removeItem('vriksha_qwen_key');

      if (googleTtsKey) localStorage.setItem('vriksha_google_tts_key', googleTtsKey);
      else localStorage.removeItem('vriksha_google_tts_key');

      if (geminiKey) localStorage.setItem('vriksha_gemini_key', geminiKey);
      else localStorage.removeItem('vriksha_gemini_key');

      loadLocalKeys();
      refreshAPIStatus();

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="vw-lang-section vw-byok-section" style={{ paddingBottom: isOpen ? '0' : '1.5rem' }}>
      <div
        className="vw-lang-section-title"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isOpen ? '1rem' : '0' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Key size={18} /> BRING YOUR OWN KEYS</span>
        <span style={{ color: '#a0aec0' }}>{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </div>

      {isOpen && (
        <>
          <div className="vw-lang-section-sub" style={{ marginBottom: '1rem' }}>
            Provide your API keys to power the LangGraph orchestration loop. Stored securely in your browser's local storage.
          </div>

          <div style={{ margin: '0 1.5rem 1.5rem', padding: '10px 12px', background: 'rgba(245, 166, 35, 0.1)', border: '1px solid rgba(245, 166, 35, 0.3)', borderRadius: '6px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <AlertCircle size={16} style={{ color: '#f5a623', flexShrink: 0, marginTop: '2px' }} />
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#e2e8f0', textAlign: 'left', lineHeight: 1.4 }}>
              <strong>Note:</strong> VRIKSHA uses free-tier API keys by default for DEMO. You may experience timeouts or failures during traffic and heavy agent loads.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', padding: '0 1.5rem 1.5rem', textAlign: 'left' }}>
            {/* Groq */}
            <div className="vw-input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#a0aec0', marginBottom: '6px' }}>
                <span>Groq API Key <span style={{ color: '#f56565' }}>*</span></span>
                <span style={{ opacity: 0.6 }}>Planning & ASR</span>
              </label>
              <input
                type="password"
                placeholder="gsk_..."
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#fff', fontSize: '0.85rem', outline: 'none'
                }}
              />
            </div>

            {/* Qwen/OpenRouter */}
            <div className="vw-input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#a0aec0', marginBottom: '6px' }}>
                <span>OpenRouter (Qwen3)</span>
                <span style={{ opacity: 0.6 }}>Code Gen</span>
              </label>
              <input
                type="password"
                placeholder="sk-or-v1-..."
                value={qwenKey}
                onChange={(e) => setQwenKey(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#fff', fontSize: '0.85rem', outline: 'none'
                }}
              />
            </div>

            {/* Gemini */}
            <div className="vw-input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#a0aec0', marginBottom: '6px' }}>
                <span>Google Gemini</span>
                <span style={{ opacity: 0.6 }}>Reflection & STT</span>
              </label>
              <input
                type="password"
                placeholder="AIza..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#fff', fontSize: '0.85rem', outline: 'none'
                }}
              />
            </div>

            {/* AWS Bedrock */}
            <div className="vw-input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#a0aec0', marginBottom: '6px' }}>
                <span>AWS Bedrock</span>
                <span style={{ opacity: 0.6 }}>Alt Planner</span>
              </label>
              <input
                type="password"
                placeholder="AKIA..."
                value={bedrockKey}
                onChange={(e) => setBedrockKey(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#fff', fontSize: '0.85rem', outline: 'none'
                }}
              />
            </div>
          </div>

          <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={handleSave}
              disabled={saved}
              style={{
                padding: '10px 24px', background: saved ? '#4caf50' : 'var(--lime)', border: 'none',
                color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem',
                fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s'
              }}
            >
              {saved ? <><CheckCircle size={16} /> Keys Saved to Browser</> : 'Save Configuration'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
