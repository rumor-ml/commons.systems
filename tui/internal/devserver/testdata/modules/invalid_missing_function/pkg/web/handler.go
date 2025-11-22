package web

import "net/http"

// No RegisterRoutes function - server won't be able to register this module
func SomeOtherFunction(mux *http.ServeMux) error {
	return nil
}
