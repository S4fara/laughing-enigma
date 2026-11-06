import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import * as cloud from './cloud';

export default function CloudTab({ onChanged }: { onChanged: () => void }) {
  const [connected, setConnected] = useState(!!cloud.getCloud());
  const [url, setUrl] = useState(cloud.getCloud()?.url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const count = useLiveQuery(() => db.tracks.filter((t) => !!t.remoteId).count(), []);

  async function connect() {
    setBusy(true);
    setMsg('');
    try {
      cloud.saveCloud(url, token);
      await cloud.ping();
      await cloud.syncLibrary();
      setConnected(true);
      setToken('');
      onChanged();
    } catch (e) {
      cloud.clearCredentials();
      setMsg(e instanceof Error ? e.message : 'Не удалось подключиться');
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setMsg('');
    try {
      await cloud.syncLibrary();
      setMsg('Готово, библиотека обновлена.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось синхронизировать');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Отключить облако? Треки из облака и скачанные файлы удалятся с этого устройства. Сами файлы в облаке останутся.')) return;
    setBusy(true);
    await cloud.disconnectCloud();
    setConnected(false);
    setUrl('');
    setMsg('');
    setBusy(false);
    onChanged();
  }

  if (connected) {
    const last = cloud.lastSync();
    return (
      <div className="cloud">
        <p>
          Облако подключено. Треков в облаке: {count ?? 0}.
          {last ? ` Последняя синхронизация: ${new Date(last).toLocaleString('ru-RU')}.` : ''}
        </p>
        <p className="hint">Отправьте файл своему боту в Telegram, и он появится здесь после синхронизации.</p>
        <div className="sub-bar">
          <button className="primary" disabled={busy} onClick={syncNow}>
            {busy ? 'Синхронизируем…' : 'Синхронизировать'}
          </button>
          <button className="danger" disabled={busy} onClick={disconnect}>
            Отключить
          </button>
        </div>
        {msg && <p className="hint">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="cloud">
      <p>Подключите своего бота, чтобы слушать музыку из Telegram на всех устройствах. Адрес и токен вы получили при настройке сервера (инструкция в папке worker).</p>
      <label className="field">
        Адрес сервера
        <input type="url" placeholder="https://player-bot.….workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" />
      </label>
      <label className="field">
        Токен (APP_TOKEN)
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <button className="add" disabled={busy || !url.trim() || !token.trim()} onClick={connect}>
        {busy ? 'Подключаем…' : 'Подключить'}
      </button>
      {msg && <p className="hint err">{msg}</p>}
    </div>
  );
}
