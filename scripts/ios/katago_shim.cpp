// Runs KataGo inside the app, where iOS forbids child processes: katago_ios_run(argc, argv, in, out, err)
// behaves like the katago binary with its stdin/stdout/stderr on the given file descriptors, which the
// caller owns and closes. Closing `in` ends an `analysis` run (start it with -quit-without-waiting).
// Built and merged into libkatago_ios.a by scripts/build-katago-ios.sh, which renames KataGo's main.
#include <cerrno>
#include <csignal>
#include <exception>
#include <iostream>
#include <mutex>
#include <streambuf>
#include <unistd.h>

int katago_main(int argc, const char* const* argv); // KataGo's main.cpp, compiled with -Dmain=katago_main
namespace ScoreValue { void freeTables(); }

namespace {

class FdBuf : public std::streambuf {
  int fd;
  char buf[1 << 16];

 public:
  FdBuf(int fd, bool input) : fd(fd) {
    if(input) setg(buf, buf, buf);
    else setp(buf, buf + sizeof(buf));
  }

 protected:
  int_type underflow() override {
    ssize_t n;
    do n = read(fd, buf, sizeof(buf)); while(n < 0 && errno == EINTR);
    if(n <= 0) return traits_type::eof();
    setg(buf, buf, buf + n);
    return traits_type::to_int_type(*gptr());
  }
  int_type overflow(int_type c) override {
    if(sync() != 0) return traits_type::eof();
    if(!traits_type::eq_int_type(c, traits_type::eof())) { *pptr() = traits_type::to_char_type(c); pbump(1); }
    return traits_type::not_eof(c);
  }
  int sync() override {
    for(char* p = pbase(); p < pptr();) {
      ssize_t n = write(fd, p, pptr() - p);
      if(n < 0 && errno == EINTR) continue;
      if(n <= 0) { setp(buf, buf + sizeof(buf)); return -1; }
      p += n;
    }
    setp(buf, buf + sizeof(buf));
    return 0;
  }
};

std::mutex running; // cin/cout/cerr are process-wide, so one run at a time

}

extern "C" int katago_ios_run(int argc, const char** argv, int in_fd, int out_fd, int err_fd) {
  std::lock_guard<std::mutex> lock(running);
  signal(SIGPIPE, SIG_IGN); // a closed reader must surface as a write error, not kill the app
  FdBuf in(in_fd, true), out(out_fd, false), err(err_fd, false);
  std::streambuf* oldIn = std::cin.rdbuf(&in);
  std::streambuf* oldOut = std::cout.rdbuf(&out);
  std::streambuf* oldErr = std::cerr.rdbuf(&err);
  int rc;
  try {
    rc = katago_main(argc, argv);
  } catch(const std::exception& e) {
    std::cerr << "Uncaught exception: " << e.what() << std::endl;
    rc = 1;
  } catch(...) {
    std::cerr << "Uncaught exception that is not a std::exception" << std::endl;
    rc = 1;
  }
  std::cout.flush();
  std::cerr.flush();
  // rdbuf() also clears the eof/bad flags this run left, so the next run starts clean.
  std::cin.rdbuf(oldIn);
  std::cout.rdbuf(oldOut);
  std::cerr.rdbuf(oldErr);
  // A throw skips KataGo's own freeTables, and the next initTables asserts the table is unset.
  ScoreValue::freeTables();
  return rc;
}
