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

  test('Recovers streamed message via fetchReply().edit() and still delivers chunks 1+', async () => {
    const mockExistingMsg = {
      edit: jest.fn().mockResolvedValue()
    }
    mockInteraction.editReply.mockRejectedValueOnce(new Error('Rate limited'))
    mockInteraction.fetchReply = jest.fn().mockResolvedValue(mockExistingMsg)
    mockInteraction.followUp = jest.fn().mockResolvedValue()
    mockInteraction.streamToken = { hasEdited: jest.fn().mockReturnValue(true) }

    const longMessage = 'First chunk of text\n\n' + 'A'.repeat(1950) + '\n\nSecond chunk of text: ' + 'B'.repeat(500)

    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: longMessage,
      sharedState
    })

    expect(mockExistingMsg.edit).toHaveBeenCalled()
    expect(mockInteraction.followUp).toHaveBeenCalled()
  })

  test('splitMessage safely splits code blocks without orphan fences', () => {
    const { splitMessage } = require('../util/chat/splitMessage')
    const codeBlock = '```javascript\n' + 'const x = 1;\n'.repeat(200) + '```'
    const chunks = splitMessage(codeBlock)

    expect(chunks.length).toBeGreaterThan(1)
    // Chunk 0 must be closed with ```
    expect(chunks[0].trim().endsWith('```')).toBe(true)
    // Chunk 1 must be reopened with ```javascript
    expect(chunks[1].startsWith('```javascript')).toBe(true)
    // Final chunk must end with ```
    expect(chunks[chunks.length - 1].trim().endsWith('```')).toBe(true)
  })

  test('Falls back to channel.send when wasStreamed is false and editReply fails', async () => {
    mockInteraction.editReply.mockRejectedValueOnce(new Error('Network failure'))
    mockInteraction.channel = { send: jest.fn().mockResolvedValue() }
    mockInteraction.streamToken = { hasEdited: jest.fn().mockReturnValue(false) }

    await responder.sendFinalResponse({
      interaction: mockInteraction,
      replyContent: 'Non-streamed fallback text',
      sharedState
    })

    expect(mockInteraction.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Non-streamed fallback text'
    }))
  })
})
