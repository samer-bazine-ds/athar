import { supabase } from "../supabaseClient.js";
import { getState, setState, resetState } from "../core/state.js";
import { emit } from "../core/events.js";
import { unsubscribeAll } from "../core/realtime.js";
import { unmountActiveModule } from "../core/moduleRegistry.js";

let authSubscription = null;
export async function restoreAuth(surface = null) {
  const { data:{ session }, error } = await supabase.auth.getSession();
  if(error) throw error;
  setState({session,user:session?.user||null,surface});
  if(session?.user) await loadIdentity();
  if(!authSubscription){
    const { data }=supabase.auth.onAuthStateChange((event,sessionNow)=>{
      setState({session:sessionNow,user:sessionNow?.user||null});
      emit("auth:changed",{event,userId:sessionNow?.user?.id||null,hasSession:Boolean(sessionNow)});
      if(!sessionNow?.user){
        setState({profile:null,memberships:[],agency:null,membership:null,role:null,clientId:null,folders:[],selectedFolderId:null,selectedModule:null,ready:false});
        if(getState().surface!=="login") location.replace("login.html");
      }else if(event!=="TOKEN_REFRESHED"){
        // Do not await Supabase calls inside the auth callback; the auth client
        // holds an internal lock while this callback runs.
        setTimeout(()=>loadIdentity().catch(error=>console.error(error)),0);
      }
    });
    authSubscription=data.subscription;
  }
  return session;
}
export async function loadIdentity(){
  const user=getState().user; if(!user){setState({profile:null,memberships:[]});return;}
  const [{data:profile,error:pErr},{data:memberships,error:mErr}]=await Promise.all([
    supabase.from("profiles").select("*").eq("id",user.id).maybeSingle(),
    supabase.from("agency_members").select("*, agencies(*)").eq("profile_id",user.id)
  ]);
  if(pErr)throw pErr;if(mErr)throw mErr;setState({profile:profile||null,memberships:memberships||[]});
}
export async function signIn(email,password){const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;setState({session:data.session,user:data.user});await loadIdentity();return data;}
export async function signUp(email,password,fullName){const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});if(error)throw error;return data;}
export async function requestPasswordReset(email){const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}${location.pathname.replace(/[^/]+$/,"")}login.html?mode=reset`});if(error)throw error;}
export async function updatePassword(password){const {error}=await supabase.auth.updateUser({password});if(error)throw error;}
export async function signOut(){emit("app:teardown",{reason:"signout"});await unmountActiveModule();unsubscribeAll();await supabase.auth.signOut();resetState();location.replace("login.html");}
export function destroyAuthListener(){authSubscription?.unsubscribe?.();authSubscription=null;}
