export type OwnedDevice = {
  id: string;
  device_id: string;
  device_name: string;
  wallet_address: string;
  owner_wallet_address: string;
  orchestrator_url: string | null;
  registration_token?: string | null;
  registered_at: string | null;
  created_at: string;
};
