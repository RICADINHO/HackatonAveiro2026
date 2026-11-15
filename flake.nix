{
  description = "Basic python environment in nix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          cudaSupport = true;
        };
      };
    in {
      devShells.${system}.default = pkgs.mkShell {
        name = "edgerock-env";
        buildInputs = with pkgs; [
          uv
          git
          python312
          cudaPackages.cudatoolkit
          stdenv.cc.cc.lib
          zlib
          pkgs.autoAddDriverRunpath
        ];
        shellHook = ''
          export UV_PROJECT_ENVIRONMENT=".venv"
          export UV_PYTHON_DOWNLOADS=never
          export CUDA_PATH="${pkgs.cudaPackages.cudatoolkit}"
          export LD_LIBRARY_PATH="/run/opengl-driver/lib:${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:$LD_LIBRARY_PATH"
          export LIBRARY_PATH="/run/opengl-driver/lib:/run/opengl-driver/lib/stubs:${pkgs.cudaPackages.cudatoolkit}/lib:${pkgs.cudaPackages.cudatoolkit}/lib/stubs:$LIBRARY_PATH"
          export TRITON_LIBCUDA_PATH="/run/opengl-driver/lib"
          export TMPDIR="/tmp/edgerock"
          mkdir -p "$TMPDIR"

          echo "ready (CUDA driver visible via /run/opengl-driver/lib)."
          echo ""
          echo "First-time setup:"
          echo "  uv venv .venv --python ${pkgs.python312}/bin/python3.12"
          echo "  source .venv/bin/activate"
          echo "  uv pip install -r requirements.txt"
        '';
      };
    };
}