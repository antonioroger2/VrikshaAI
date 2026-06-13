import React, { useState, useEffect } from 'react';
import { Key, X, CheckCircle, AlertCircle } from 'lucide-react';
import { loadLocalKeys } from '../lib/api-config';
import { useAgentStore } from '../store/agent-store';

interface BYOKModalProps {
  onClose: () => void;
}

export default function BYOKModal({ onClose }: BYOKModalProps) {
  const [bedrockKey, setBedrockKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [qwenKey, setQwenKey] = useState('');
  const [googleTtsKey, setGoogleTtsKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const refreshAPIStatus = useAgentStore(s => s.refreshAPIStatus);

  useEffect(() => {
    // Load existing keys from local storage
    if (typeof window !== 'undefined') {
      setBedrockKey(localStorage.getItem('vriksha_bedrock_key') || '');
      setGroqKey(localStorage.getItem('vriksha_groq_key') || '');
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

      // Update API_CONFIG
      loadLocalKeys();
      // Update Agent Store status
      refreshAPIStatus();

      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1200);
    }
  };

  return (
    <div className="vw-modal-backdrop" style={{ zIndex: 9999 }}>
      <div className="vw-modal-content" style={{ maxWidth: '500px' }}>
        <button className="vw-modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ padding: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
            <Key size={24} style={{ color: 'var(--lime)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Bring Your Own Key</h2>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#a0aec0' }}>Stored securely in your browser's local storage.</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Groq */}
          <div className="vw-input-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
              <span>Groq API Key <span style={{ color: '#f56565' }}>*</span></span>
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>For Planning & ASR</span>
            </label>
            <input
              type="password"
              placeholder="gsk_..."
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>

          {/* Qwen/OpenRouter */}
          <div className="vw-input-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
              <span>OpenRouter Key (Qwen3)</span>
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>For Code Generation</span>
            </label>
            <input
              type="password"
              placeholder="sk-or-v1-..."
              value={qwenKey}
              onChange={(e) => setQwenKey(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>

          {/* AWS Bedrock */}
          <div className="vw-input-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
              <span>AWS Bedrock Key (Optional)</span>
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>Alternative Planner</span>
            </label>
            <input
              type="password"
              placeholder="AKIA..."
              value={bedrockKey}
              onChange={(e) => setBedrockKey(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>

          {/* Gemini */}
          <div className="vw-input-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
              <span>Google Gemini Key (Optional)</span>
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>For Reflection & Translation</span>
            </label>
            <input
              type="password"
              placeholder="AIza..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>

          {/* Google TTS */}
          <div className="vw-input-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
              <span>Google TTS Key (Optional)</span>
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>For High-Quality Speech</span>
            </label>
            <input
              type="password"
              placeholder="AIza..."
              value={googleTtsKey}
              onChange={(e) => setGoogleTtsKey(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>

          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button 
              onClick={onClose}
              style={{
                padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem'
              }}
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              disabled={saved}
              style={{
                padding: '8px 16px', background: saved ? '#4caf50' : 'var(--lime)', border: 'none',
                color: '#000', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem',
                fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              {saved ? <><CheckCircle size={16} /> Saved</> : 'Save Keys'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
