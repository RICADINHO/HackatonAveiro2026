{ config, lib, ... }:

let
  cfg = config.services.aveiroUrban;
in
{
  options.services.aveiroUrban = {
    enable = lib.mkEnableOption "the Aveiro urban inventory";
    apiHost = lib.mkOption {
      type = lib.types.str;
      description = "Public DNS name of the inventory API.";
    };
    repository = lib.mkOption {
      type = lib.types.str;
      default = "/srv/aveiro-urban";
      description = "Path to the checkout and its Python virtual environment.";
    };
    environmentFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/aveiro-urban.env";
      description = "Path to the runtime environment file on the server.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.aveiro = {};
    users.users.aveiro = { isSystemUser = true; group = "aveiro"; };

    services.postgresql = {
      enable = true;
      extensions = ps: [ ps.postgis ];
      ensureDatabases = [ "aveiro" ];
      ensureUsers = [{ name = "aveiro"; ensureDBOwnership = true; }];
    };

    systemd.services.aveiro-urban = {
      description = "Aveiro urban inventory API";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "postgresql.service" ];
      wants = [ "network-online.target" ];
      requires = [ "postgresql.service" ];
      serviceConfig = {
        User = "aveiro";
        Group = "aveiro";
        WorkingDirectory = cfg.repository;
        EnvironmentFile = cfg.environmentFile;
        StateDirectory = "aveiro-urban";
        StateDirectoryMode = "0755";
        UMask = "0022";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        PrivateTmp = true;
        ExecStart = "${cfg.repository}/.venv/bin/python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000";
        Restart = "on-failure";
      };
    };

    services.caddy = {
      enable = true;
      extraConfig = builtins.readFile ./Caddyfile;
    };
    systemd.services.caddy.environment.AVEIRO_API_DOMAIN = cfg.apiHost;
    networking.firewall.allowedTCPPorts = [ 80 443 ];
  };
}
