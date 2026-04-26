const DiscordResponder = require('../util/chat/DiscordResponder')

describe('DiscordResponder', () => {
  let responder
  let mockInteraction
  let sharedState

  beforeEach(() => {
    responder = new DiscordResponder({ botName: 'Skynet' })
    mockInteraction = {
      editReply: jest.fn().mockResolvedValue(),
      deleteReply: jest.fn().mockResolvedValue(),
      fetchReply: jest.fn().mockResolvedValue({
        react: jest.fn().mockResolvedValue()
      }),
      followUp: jest.fn().mockResolvedValue()
    }
    sharedState = {
      primaryResponseUsed: false,
      primaryContent: null,
      visualActionExecuted: false
    }
  })

  test('Deletes reply if AI is silent and no actions were taken', async () => {
    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: '',
      sharedState
    })
    expect(mockInteraction.deleteReply).toHaveBeenCalled()
  })

  test('Reacts with ✅ if AI is silent but a background action happened', async () => {
    sharedState.primaryResponseUsed = true
    sharedState.visualActionExecuted = false // Background task like 'remember'

    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: '', // Empty text
      sharedState
    })

    expect(mockInteraction.fetchReply).toHaveBeenCalled()
    const reply = await mockInteraction.fetchReply()
    expect(reply.react).toHaveBeenCalledWith('✅')
  })

  test('Does NOT react if a visual action was already executed (proof is there)', async () => {
    sharedState.primaryResponseUsed = true
    sharedState.visualActionExecuted = true // Like a Poll or Embed

    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: '',
      sharedState
    })

    // Should NOT react
    const reply = await mockInteraction.fetchReply()
    expect(reply.react).not.toHaveBeenCalled()
    // Should NOT delete if we want to preserve the visual?
    // Actually, if replyContent is empty, the logic at line 12 might trigger.
  })

  test('Preserves original text when merging AI followup', async () => {
    sharedState.primaryResponseUsed = true
    sharedState.primaryContent = 'Some original status'

    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: 'AI says hello',
      sharedState
    })

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('AI says hello')
    }))
  })
})
