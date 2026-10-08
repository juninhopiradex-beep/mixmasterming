// Teste do verificador:  ./verify_cli <comprovativo> <chave-pública-spki-base64> [machineId]
//   g++ -std=c++17 -O2 verify_cli.cpp -lcrypto -o verify_cli
#include "mmx_license.hpp"
#include <chrono>
#include <iostream>
int main(int argc, char** argv) {
  if (argc < 3) { std::cerr << "uso: verify_cli <token> <spki-base64> [machineId]\n"; return 1; }
  std::string mid = argc > 3 ? argv[3] : mmx::machineId();
  long long now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  auto r = mmx::verify(argv[1], argv[2], mid, now);
  std::cout << "{\"ok\":" << (r.ok ? "true" : "false") << ",\"why\":\"" << r.why << "\",\"type\":\"" << r.type << "\",\"major\":" << r.major << ",\"exp\":" << r.exp << ",\"needsCheck\":" << (r.needsCheck ? "true" : "false") << "}\n";
  return r.ok ? 0 : 2;
}
