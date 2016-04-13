# smptt
simple multi-path TCP tunnel

```
Usage: cli [options]

  Options:

    -h, --help           output usage information
    -V, --version        output the version number
    -p, --port <n>       port number, required
    --key <file>         tls key file, required when using tls
    --cert <file>        tls crt file, optional when using tls
    --ca <file>          ca crt file, optional when using tls
    -P, --peer [addr]    peer address like localhost:8081, required as sender
    -t, --target <addr>  target address like localhost:8082, required as receiver
```
