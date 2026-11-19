{
  description = "Basic python environment in nix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
    in {
      devShells = forAllSystems (system:
        let
          # CUDA in nixpkgs is x86_64-only (ignoring Jetson overlays).
          hasCuda = system == "x86_64-linux";

          pkgs = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
              cudaSupport = hasCuda;
            };
          };

          cudaPackages = if hasCuda then pkgs.cudaPackages else null;
        in {
          default = pkgs.mkShell {
            name = "edgerock-env";
            buildInputs = with pkgs; [
              (postgresql.withPackages (ps: [ ps.postgis ]))
              # Python
              uv
              git
              python312
              stdenv.cc.cc.lib
              zlib

              # Node / React / GitHub Pages tooling
              nodejs_26
              # firebase-tools
              # nodePackages.npm
            ] ++ (if hasCuda then [
              cudaPackages.cudatoolkit
              pkgs.autoAddDriverRunpath
            ] else []);
            shellHook = ''
              export UV_PROJECT_ENVIRONMENT=".venv"
              export UV_PYTHON_DOWNLOADS=never
              ${if hasCuda then ''
                export CUDA_PATH="${cudaPackages.cudatoolkit}"
              '' else ""}
              export LD_LIBRARY_PATH="/run/opengl-driver/lib:${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:$LD_LIBRARY_PATH"
              export LIBRARY_PATH="/run/opengl-driver/lib:/run/opengl-driver/lib/stubs:${if hasCuda then "${cudaPackages.cudatoolkit}/lib:${cudaPackages.cudatoolkit}/lib/stubs" else ""}:$LIBRARY_PATH"
              export TRITON_LIBCUDA_PATH="/run/opengl-driver/lib"
              export TMPDIR="/tmp/edgerock"
              mkdir -p "$TMPDIR"

              echo "ready (${system}${if hasCuda then ", CUDA via /run/opengl-driver/lib" else ", no CUDA"})."
              echo ""
              echo "Python first-time setup:"
              echo "  uv venv .venv --python ${pkgs.python312}/bin/python3.12"
              echo "  source .venv/bin/activate"
              echo "  uv pip install -r requirements.txt"
              echo ""
              echo "React / GitHub Pages:"
              echo "  npm create vite@latest dot -- --template react-ts"
              echo "  cd dot"
              echo "  npm install gh-pages --save-dev"
              echo "  npm run deploy"
            '';
          };
        });
    };
}