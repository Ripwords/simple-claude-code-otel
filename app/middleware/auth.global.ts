export default defineNuxtRouteMiddleware(async (to) => {
  const { signedIn } = await loadAuthState()

  if (!signedIn && to.path !== '/login') {
    return navigateTo('/login')
  }

  if (signedIn && to.path === '/login') {
    return navigateTo('/')
  }
})
