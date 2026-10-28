
FROM gcc:14

WORKDIR /app

COPY . .

RUN g++ -std=c++17 -O2 main.cpp -o deadlock_server

EXPOSE 8080

CMD ["sh", "-c", "./deadlock_server ${PORT:-8080}"]
