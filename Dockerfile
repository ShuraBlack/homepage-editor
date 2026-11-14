FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /homepage-editor .

FROM gcr.io/distroless/static-debian12
COPY --from=build /homepage-editor /homepage-editor
EXPOSE 3001
ENTRYPOINT ["/homepage-editor"]
