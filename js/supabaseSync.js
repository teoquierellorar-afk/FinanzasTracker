/**
 * Módulo de autenticación y sincronización en la nube con Supabase.
 * Carga @supabase/supabase-js desde CDN con versión fija (2.119.2) y falla de
 * forma segura para no bloquear el modo local si el usuario está sin conexión.
 */

export const SUPABASE_URL = 'https://rbmvpbjoperqehwlocxj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yCoFxuP94Vgbjru-xwCHYQ_SYgC1Wao';

const SUPABASE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

let client = null;
let loadError = null;

function getRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

export async function getSupabaseClient() {
  if (client) return client;
  if (loadError) return null;
  try {
    const mod = await import(SUPABASE_ESM_URL);
    client = mod.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return client;
  } catch (err) {
    loadError = err;
    console.warn('No se pudo cargar el SDK de Supabase (modo local activo):', err);
    return null;
  }
}

export async function initSupabaseAuth(onSessionChange) {
  const sb = await getSupabaseClient();
  if (!sb) {
    onSessionChange(null, { offlineSdk: true });
    return null;
  }

  sb.auth.onAuthStateChange((_event, session) => {
    onSessionChange(session?.user || null, { event: _event });
  });

  const { data } = await sb.auth.getSession();
  const sessionUser = data?.session?.user || null;
  if (sessionUser) {
    const { data: userCheck, error } = await sb.auth.getUser();
    if (!error && userCheck?.user) {
      onSessionChange(userCheck.user, { event: 'INITIAL_SESSION' });
      return userCheck.user;
    }
    onSessionChange(null, { event: 'SIGNED_OUT' });
    return null;
  }

  onSessionChange(null, { event: 'INITIAL_SESSION' });
  return null;
}

export async function signInWithPassword(email, password) {
  const sb = await getSupabaseClient();
  if (!sb) throw new Error('Sin conexión con el servicio de autenticación.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithPassword(email, password) {
  const sb = await getSupabaseClient();
  if (!sb) throw new Error('Sin conexión con el servicio de autenticación.');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getRedirectUrl(),
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithMagicLink(email) {
  const sb = await getSupabaseClient();
  if (!sb) throw new Error('Sin conexión con el servicio de autenticación.');
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getRedirectUrl(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const sb = await getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function fetchCloudFinances(userId) {
  const sb = await getSupabaseClient();
  if (!sb) throw new Error('Sin conexión con Supabase.');
  const { data, error } = await sb
    .from('user_finances')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCloudFinances(userId, stateObj) {
  const sb = await getSupabaseClient();
  if (!sb) throw new Error('Sin conexión con Supabase.');
  const { error } = await sb
    .from('user_finances')
    .upsert(
      {
        user_id: userId,
        state: stateObj,
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}
